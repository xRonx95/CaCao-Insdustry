-- Apply once after 001-009. Online-only batch tracking with immutable stage history.
begin;
create unique index harvests_batch_scope on public.harvests(id,owner_id,plantation_id);
create table public.harvest_batches (
  id uuid primary key,owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  harvest_id uuid not null,code text not null check(char_length(code) between 1 and 60),
  allocated_wet_kg numeric(12,3) not null check(allocated_wet_kg>0),
  current_weight_kg numeric(12,3) not null check(current_weight_kg>0 and current_weight_kg<=allocated_wet_kg),
  stage text not null check(stage in ('harvested','fermenting','drying','quality_check','stored','sold')),
  stage_on date not null,quality_result text check(quality_result in ('pass','hold','fail')),
  moisture_pct numeric(5,2) check(moisture_pct between 0 and 100),
  buyer text,sale_php numeric(14,2) check(sale_php between 0 and 999999999999),
  revision integer not null default 1,created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
  unique(owner_id,code),unique(id,owner_id),
  foreign key(harvest_id,owner_id,plantation_id) references public.harvests(id,owner_id,plantation_id),
  check(stage<>'sold' or (nullif(trim(buyer),'') is not null and sale_php is not null))
);
create table public.harvest_batch_events (
  id uuid primary key,batch_id uuid not null,owner_id uuid not null,
  actor_id uuid not null references auth.users(id),stage text not null,
  event_on date not null,weight_kg numeric(12,3) not null check(weight_kg>0),
  moisture_pct numeric(5,2),quality_result text,buyer text,sale_php numeric(14,2),
  note text not null check(char_length(trim(note)) between 3 and 2000),
  revision integer not null,request jsonb not null,created_at timestamptz not null default clock_timestamp(),
  foreign key(batch_id,owner_id) references public.harvest_batches(id,owner_id),unique(batch_id,revision)
);
create index harvest_batches_scope on public.harvest_batches(owner_id,plantation_id,stage);
create index harvest_batch_events_scope on public.harvest_batch_events(batch_id,revision);
alter table public.harvest_batches enable row level security;
alter table public.harvest_batch_events enable row level security;
revoke all on public.harvest_batches,public.harvest_batch_events from public,anon,authenticated;
grant select on public.harvest_batches,public.harvest_batch_events to authenticated;
create policy scoped_read on public.harvest_batches for select to authenticated using(private.can_access(owner_id));
create policy scoped_read on public.harvest_batch_events for select to authenticated using(private.can_access(owner_id));

-- No direct client writes. This atomic command owns the materialized state and timeline.
create function public.save_harvest_batch(p_request_id uuid,p_payload jsonb)
returns public.harvest_batches language plpgsql security definer set search_path='' as $$
declare b public.harvest_batches; h public.harvests; e public.harvest_batch_events;
  v_stage text; v_on date; v_weight numeric; v_moisture numeric; v_quality text;
  v_buyer text; v_sale numeric; v_note text; v_code text; v_total numeric;
begin
  if auth.uid() is null or private.user_role() is null then raise exception 'Sign in with an active account'; end if;
  if p_request_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'A submission ID and command are required'; end if;
  -- Serializes retries of a request, including a lost acknowledgement.
  perform pg_advisory_xact_lock(hashtextextended('batch-request:'||p_request_id,0));
  select * into e from public.harvest_batch_events where id=p_request_id;
  if found then
    if e.actor_id<>auth.uid() or not private.can_access(e.owner_id) or e.request is distinct from p_payload then raise exception 'Submission ID already used for a different command'; end if;
    select * into b from public.harvest_batches where id=e.batch_id;
    return b;
  end if;
  v_on=(p_payload->>'event_on')::date;v_weight=(p_payload->>'weight_kg')::numeric;
  v_note=trim(coalesce(p_payload->>'note',''));
  if v_on is null or v_on>(now() at time zone 'Asia/Manila')::date then raise exception 'Choose a valid date that is not in the future'; end if;
  if v_weight is null or v_weight<=0 or v_weight>999999999 or v_weight<>round(v_weight,3) then raise exception 'Weight must be positive with at most 3 decimal places'; end if;
  if char_length(v_note) not between 3 and 2000 then raise exception 'Write a note between 3 and 2000 characters'; end if;
  if p_payload->>'action'='create' then
    select * into h from public.harvests where id=(p_payload->>'harvest_id')::uuid for update;
    if not found or not private.can_access(h.owner_id) then raise exception 'Harvest not available to your account'; end if;
    if v_on<h.harvest_date then raise exception 'Batch date cannot precede its harvest'; end if;
    v_code=upper(trim(coalesce(p_payload->>'code','')));
    if char_length(v_code) not between 1 and 60 then raise exception 'Enter a batch code of up to 60 characters'; end if;
    select coalesce(sum(allocated_wet_kg),0) into v_total from public.harvest_batches where harvest_id=h.id;
    if v_total+v_weight>h.wet_bean_kg then raise exception 'Batch allocations exceed the harvest wet-bean weight'; end if;
    insert into public.harvest_batches(id,owner_id,plantation_id,harvest_id,code,allocated_wet_kg,current_weight_kg,stage,stage_on,created_by)
      values(p_request_id,h.owner_id,h.plantation_id,h.id,v_code,v_weight,v_weight,'harvested',v_on,auth.uid()) returning * into b;
  elsif p_payload->>'action'='advance' then
    select * into b from public.harvest_batches where id=(p_payload->>'batch_id')::uuid for update;
    if not found or not private.can_access(b.owner_id) then raise exception 'Batch not available to your account'; end if;
    if (p_payload->>'expected_revision')::integer is distinct from b.revision then raise exception 'This batch changed. Refresh and review its history before submitting'; end if;
    if b.stage='sold' then raise exception 'This batch is already sold'; end if;
    v_stage=p_payload->>'stage';
    if v_stage is null or not (
      (b.stage='harvested' and v_stage='fermenting') or (b.stage='fermenting' and v_stage='drying') or
      (b.stage='drying' and v_stage='quality_check') or (b.stage='quality_check' and v_stage='quality_check') or
      (b.stage='quality_check' and v_stage='stored') or (b.stage='stored' and v_stage='sold')
    ) then raise exception 'Follow the batch stages in order'; end if;
    if v_on<b.stage_on then raise exception 'Stage date cannot precede the previous event'; end if;
    if v_weight>b.current_weight_kg then raise exception 'Weight cannot increase; create a separate batch for additional beans'; end if;
    if v_stage='sold' and v_weight<>b.current_weight_kg then raise exception 'Use the whole stored batch weight; partial sales are not supported'; end if;
    v_moisture=nullif(p_payload->>'moisture_pct','')::numeric;v_quality=nullif(p_payload->>'quality_result','');
    v_buyer=nullif(trim(coalesce(p_payload->>'buyer','')),'');v_sale=nullif(p_payload->>'sale_php','')::numeric;
    if v_stage='quality_check' and (v_quality is null or v_quality not in ('pass','hold','fail') or v_moisture is null or v_moisture<0 or v_moisture>100 or v_moisture<>round(v_moisture,2)) then raise exception 'Record a quality result and moisture percentage (0–100)'; end if;
    if v_stage<>'quality_check' and (v_moisture is not null or v_quality is not null) then raise exception 'Quality measurements belong to the quality-check stage'; end if;
    if v_stage='stored' and b.quality_result is distinct from 'pass' then raise exception 'Pass the quality check before storage; record a repeat check if needed'; end if;
    if v_stage='sold' and (v_buyer is null or char_length(v_buyer)>200 or v_sale is null or v_sale<0 or v_sale>999999999999 or v_sale<>round(v_sale,2)) then raise exception 'Enter the buyer and total sale amount in PHP (up to 2 decimal places)'; end if;
    if v_stage<>'sold' and (v_buyer is not null or v_sale is not null) then raise exception 'Buyer and sale amount belong to the sale stage'; end if;
    update public.harvest_batches set stage=v_stage,stage_on=v_on,current_weight_kg=v_weight,
      quality_result=coalesce(v_quality,quality_result),moisture_pct=coalesce(v_moisture,moisture_pct),
      buyer=coalesce(v_buyer,buyer),sale_php=coalesce(v_sale,sale_php),revision=revision+1,updated_at=clock_timestamp()
      where id=b.id returning * into b;
  else raise exception 'Unknown batch command'; end if;
  insert into public.harvest_batch_events(id,batch_id,owner_id,actor_id,stage,event_on,weight_kg,moisture_pct,quality_result,buyer,sale_php,note,revision,request)
    values(p_request_id,b.id,b.owner_id,auth.uid(),b.stage,v_on,v_weight,v_moisture,v_quality,v_buyer,v_sale,v_note,b.revision,p_payload);
  return b;
end; $$;
revoke all on function public.save_harvest_batch(uuid,jsonb) from public,anon;
grant execute on function public.save_harvest_batch(uuid,jsonb) to authenticated;

-- Existing harvest edits must not invalidate weights and dates already allocated to batches.
create function private.guard_batched_harvest()
returns trigger language plpgsql security definer set search_path='' as $$
declare allocated numeric;
begin
  select coalesce(sum(allocated_wet_kg),0) into allocated from public.harvest_batches where harvest_id=old.id;
  if new.wet_bean_kg<allocated then raise exception 'Harvest wet weight cannot be below its allocated batches'; end if;
  if exists(select 1 from public.harvest_batch_events e join public.harvest_batches b on b.id=e.batch_id where b.harvest_id=old.id and e.event_on<new.harvest_date) then raise exception 'Harvest date cannot follow an existing batch event'; end if;
  return new;
end; $$;
revoke all on function private.guard_batched_harvest() from public;
create trigger guard_batched_harvest before update on public.harvests for each row execute function private.guard_batched_harvest();
create trigger audit_record after insert on public.harvest_batch_events for each row execute function private.audit_record();
commit;
