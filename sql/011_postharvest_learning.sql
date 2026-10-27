-- Apply once after 001-010. Measurements, agreed protocols, costs and handovers.
begin;
-- Defaults affect new entries only. Existing farm locations are retained.
alter table public.farmers alter column municipality set default '',alter column province set default 'Zamboanga del Norte';
alter table public.plantations alter column municipality set default '',alter column province set default 'Zamboanga del Norte';
create table public.postharvest_records (
 id uuid primary key,batch_id uuid not null,owner_id uuid not null,actor_id uuid not null references auth.users(id),actor_role text not null,
 kind text not null check(kind in ('protocol','fermentation','drying','quality','handover','cost')),
 observed_at timestamptz not null,detail jsonb not null check(jsonb_typeof(detail)='object'),
 note text not null check(char_length(trim(note)) between 3 and 2000),
 stage_snapshot text not null,weight_snapshot_kg numeric(12,3) not null,
 request jsonb not null,supersedes_id uuid unique references public.postharvest_records(id),created_at timestamptz not null default clock_timestamp(),
 foreign key(batch_id,owner_id) references public.harvest_batches(id,owner_id)
);
create index postharvest_scope on public.postharvest_records(owner_id,batch_id,observed_at desc);
alter table public.postharvest_records enable row level security;
revoke all on public.postharvest_records from public,anon,authenticated;
grant select on public.postharvest_records to authenticated;
create policy scoped_read on public.postharvest_records for select to authenticated using(private.can_access(owner_id));
create function public.record_postharvest(p_request_id uuid,p_payload jsonb)
returns public.postharvest_records language plpgsql security definer set search_path='' as $$
declare b public.harvest_batches;r public.postharvest_records;prior public.postharvest_records;d jsonb;k text;t timestamptz;n text;replaces uuid;started timestamptz;
 sample integer;defects integer;v numeric;field text;phase_start date;phase_end date;
begin
 if auth.uid() is null or private.user_role() is null then raise exception 'Sign in with an active account';end if;
 if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Submission ID and record are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('postharvest:'||p_request_id,0));
 select * into r from public.postharvest_records where id=p_request_id;
 if found then
  if r.actor_id<>auth.uid() or not private.can_access(r.owner_id) or r.request is distinct from p_payload then raise exception 'Submission ID already used for another record';end if;
  return r;
 end if;
 select * into b from public.harvest_batches where id=(p_payload->>'batch_id')::uuid for share;
 if not found or not private.can_access(b.owner_id) then raise exception 'Batch not available to your account';end if;
 k=p_payload->>'kind';d=p_payload->'detail';t=(p_payload->>'observed_at')::timestamptz;n=trim(coalesce(p_payload->>'note',''));
 if k is null or k not in ('protocol','fermentation','drying','quality','handover','cost') or d is null or jsonb_typeof(d)<>'object' then raise exception 'Choose a supported record type';end if;
 if t is null or t>clock_timestamp() or (t at time zone 'Asia/Manila')::date<(select min(event_on) from public.harvest_batch_events where batch_id=b.id) then raise exception 'Observation time must be between batch creation and now';end if;
 if char_length(n) not between 3 and 2000 then raise exception 'Write a note between 3 and 2000 characters';end if;
 replaces=nullif(p_payload->>'supersedes_id','')::uuid;
 if replaces is not null then
  select * into prior from public.postharvest_records where id=replaces for update;
  if not found or prior.batch_id<>b.id or prior.owner_id<>b.owner_id or prior.kind<>k then raise exception 'Correction must replace a record of the same kind in this batch';end if;
  if prior.kind in ('protocol','quality') and prior.actor_role in ('admin','super_admin','field') and not private.is_staff() then raise exception 'Assigned staff must correct reviewed protocols and quality grades';end if;
  if exists(select 1 from public.postharvest_records where supersedes_id=replaces) then raise exception 'This record was already corrected. Refresh and use the latest entry';end if;
 end if;
 if exists(select 1 from jsonb_each(d) where jsonb_typeof(value)='string' and char_length(value#>>'{}')>300) then raise exception 'Individual text fields must be at most 300 characters';end if;
 if k='protocol' then
  if not private.is_staff() then raise exception 'Assigned staff must record the buyer/adviser-agreed protocol';end if;
  if nullif(trim(d->>'reference'),'') is null or nullif(trim(d->>'facility'),'') is null then raise exception 'Name the facility and buyer/agronomist reference';end if;
  foreach field in array array['min_hours','turn_hours','max_moisture','max_defects'] loop
   v=nullif(d->>field,'')::numeric;
   if v is null or v<0 or v>(case when field in ('min_hours','turn_hours') then 1000 else 100 end) then raise exception 'Enter valid agreed protocol targets';end if;
   if field='min_hours' and v<=0 then raise exception 'Agreed minimum fermentation time must be positive';end if;
  end loop;
  started=nullif(d->>'started_at','')::timestamptz;
  if started>clock_timestamp() or (started at time zone 'Asia/Manila')::date<(select min(event_on) from public.harvest_batch_events where batch_id=b.id) then raise exception 'Fermentation start must be within the batch history and cannot be in the future';end if;
 elsif k='fermentation' then
  if b.stage='harvested' then raise exception 'Start the fermentation stage before recording checks';end if;
  select min(event_on) into phase_start from public.harvest_batch_events where batch_id=b.id and stage='fermenting';
  select min(event_on) into phase_end from public.harvest_batch_events where batch_id=b.id and stage='drying';
  if phase_start is null or (t at time zone 'Asia/Manila')::date<phase_start or (t at time zone 'Asia/Manila')::date>phase_end then raise exception 'Use the actual fermentation period for this observation';end if;
  v=(d->>'temperature_c')::numeric;
  if v is null or v<(-10) or v>100 or jsonb_typeof(d->'turned') is distinct from 'boolean' then raise exception 'Record temperature and whether beans were turned';end if;
 elsif k='drying' then
  if b.stage in ('harvested','fermenting') then raise exception 'Start the drying stage before recording drying checks';end if;
  select min(event_on) into phase_start from public.harvest_batch_events where batch_id=b.id and stage='drying';
  select min(event_on) into phase_end from public.harvest_batch_events where batch_id=b.id and stage='quality_check';
  if phase_start is null or (t at time zone 'Asia/Manila')::date<phase_start or (t at time zone 'Asia/Manila')::date>phase_end then raise exception 'Use the actual drying period for this observation';end if;
  v=(d->>'moisture_pct')::numeric;
  if v is null or v<0 or v>100 or coalesce(d->>'method','') not in ('sun','solar','mechanical','other') or coalesce(d->>'weather','') not in ('dry','humid','rain','indoor') or jsonb_typeof(d->'protected') is distinct from 'boolean' then raise exception 'Record moisture, drying method, conditions and protection';end if;
 elsif k='quality' then
  if b.stage not in ('quality_check','stored','sold') then raise exception 'Reach quality check before recording a grading assessment';end if;
  sample=(d->>'sample_beans')::integer;
  if sample is null or sample<1 or sample>100000 then raise exception 'Enter a positive sample bean count';end if;
  defects=0;
  foreach field in array array['moldy','slaty','insect_damaged'] loop
   v=(d->>field)::numeric;
   if v is null or v<0 or v>sample or v<>trunc(v) then raise exception 'Defect counts must be whole numbers within the sample';end if;
   defects=defects+v::integer;
  end loop;
  if defects>sample then raise exception 'Use mutually exclusive defect categories; their total cannot exceed the sample';end if;
  v=(d->>'moisture_pct')::numeric;
  if v is null or v<0 or v>100 or coalesce(d->>'grade','') not in ('premium','standard','downgraded','rejected','ungraded') or nullif(trim(d->>'assessor'),'') is null then raise exception 'Record moisture, grade and assessor/reference';end if;
  if d->>'grade'<>'ungraded' and not private.is_staff() then raise exception 'Farmers may record ungraded observations. Assigned staff must record the final grade';end if;
 elsif k='handover' then
  if nullif(trim(d->>'from_facility'),'') is null or nullif(trim(d->>'to_facility'),'') is null or nullif(trim(d->>'recipient'),'') is null then raise exception 'Record both locations and the named recipient';end if;
 elsif k='cost' then
  v=(d->>'amount_php')::numeric;
  if v is null or v<0 or v>999999999999 or v<>round(v,2) or coalesce(d->>'category','') not in ('labor','materials','energy','transport','testing','other') then raise exception 'Enter a valid cost category and amount in PHP';end if;
 end if;
 insert into public.postharvest_records(id,batch_id,owner_id,actor_id,actor_role,kind,observed_at,detail,note,stage_snapshot,weight_snapshot_kg,request,supersedes_id)
 values(p_request_id,b.id,b.owner_id,auth.uid(),private.user_role(),k,t,d,n,b.stage,b.current_weight_kg,p_payload,replaces) returning * into r;
 return r;
end;$$;
revoke all on function public.record_postharvest(uuid,jsonb) from public,anon;
grant execute on function public.record_postharvest(uuid,jsonb) to authenticated;
create trigger audit_record after insert on public.postharvest_records for each row execute function private.audit_record();
-- Storage requires the measurements behind the stage label, not only a manual pass.
create function private.guard_postharvest_storage()
returns trigger language plpgsql security definer set search_path='' as $$
declare protocol public.postharvest_records;quality public.postharvest_records;defects numeric;started timestamptz;
begin
 if new.stage='stored' and old.stage<>'stored' then
  select * into protocol from public.postharvest_records r where r.batch_id=old.id and r.kind='protocol'
   and not exists(select 1 from public.postharvest_records replacement where replacement.supersedes_id=r.id)
   order by observed_at desc,created_at desc,id desc limit 1;
  select * into quality from public.postharvest_records r where r.batch_id=old.id and r.kind='quality'
   and not exists(select 1 from public.postharvest_records replacement where replacement.supersedes_id=r.id)
   order by observed_at desc,created_at desc,id desc limit 1;
  if protocol.id is null or quality.id is null then raise exception 'Record an agreed protocol and quality assessment in Post-harvest quality before storage';end if;
  started=nullif(protocol.detail->>'started_at','')::timestamptz;
  if started is null or quality.observed_at<started+((protocol.detail->>'min_hours')::numeric*interval '1 hour') then raise exception 'Quality assessment does not meet the agreed minimum fermentation time';end if;
  defects=((quality.detail->>'moldy')::numeric+(quality.detail->>'slaty')::numeric+(quality.detail->>'insect_damaged')::numeric)*100/(quality.detail->>'sample_beans')::numeric;
  if (quality.detail->>'moisture_pct')::numeric>(protocol.detail->>'max_moisture')::numeric or
     new.moisture_pct is null or new.moisture_pct>(protocol.detail->>'max_moisture')::numeric or
     defects>(protocol.detail->>'max_defects')::numeric or quality.detail->>'grade' in ('rejected','ungraded') then
    raise exception 'Recorded quality does not meet this batch protocol. Review, reprocess and reassess before storage';end if;
  if new.stage_on<(quality.observed_at at time zone 'Asia/Manila')::date then raise exception 'Storage date cannot precede its quality assessment';end if;
 end if;
 return new;
end;$$;
revoke all on function private.guard_postharvest_storage() from public;
create trigger guard_postharvest_storage before update on public.harvest_batches for each row execute function private.guard_postharvest_storage();
commit;
