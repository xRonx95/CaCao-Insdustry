-- CACAO INDUSTRY: UPGRADE FROM 004 TO 011
-- Only for projects with 001 through 004 already successfully installed.
-- Back up first. Test in staging. Apply once; do not rerun installed migrations.
-- If any part of 005-011 is already installed, use only the pending numbered files.

do $$ begin
  if to_regclass('public.staff_farmer_assignments') is null or to_regprocedure('public.set_account_access(uuid,text,text)') is null then
    raise exception 'Migration 004 must be installed first.';
  end if;
  if to_regclass('public.mapping_reviews') is not null or to_regclass('public.harvests') is not null or to_regclass('public.sync_receipts') is not null then
    raise exception 'An enhancement migration is already installed. Apply only remaining numbered migrations.';
  end if;
end $$;

-- ============================================================
-- 005_mapping_integrity.sql
-- ============================================================

-- Phase 1: identity safeguards, mapping history and overlap review. Run after 004.
begin;
alter table public.farmers add column if not exists farmer_code text generated always as ('CF-'||upper(replace(id::text,'-',''))) stored;
create unique index if not exists idx_farmer_code on public.farmers(farmer_code);
create or replace function private.normalized_name(value text)
returns text language sql immutable set search_path='' as $$
  select lower(regexp_replace(trim(coalesce(value,'')),'\s+',' ','g'));
$$;
create index if not exists idx_farmer_identity on public.farmers(owner_id,private.normalized_name(full_name),birth_date);
create index if not exists idx_farmer_rsbsa on public.farmers(private.normalized_name(rsbsa_number));
create or replace function private.canonical_farmer_name()
returns trigger language plpgsql set search_path='' as $$
begin
  new.full_name=concat_ws(' ',nullif(trim(new.first_name),''),nullif(trim(new.middle_name),''),nullif(trim(new.last_name),''));
  return new;
end; $$;
create trigger a_canonical_farmer_name before insert or update on public.farmers for each row execute function private.canonical_farmer_name();
create or replace function private.prevent_duplicate_farmer()
returns trigger language plpgsql security definer set search_path='' as $$
declare candidate uuid; reference text; phone text;
begin
  reference=private.normalized_name(new.rsbsa_number);
  phone=regexp_replace(coalesce(new.contact_number,''),'[^0-9]','','g');
  perform pg_advisory_xact_lock(hashtextextended('farmer:'||new.owner_id||':'||private.normalized_name(new.full_name),0));
  if reference<>'' then perform pg_advisory_xact_lock(hashtextextended('rsbsa:'||reference,0)); end if;
  select id into candidate from public.farmers f where f.id<>new.id and (
    (reference<>'' and private.normalized_name(f.rsbsa_number)=reference) or
    (f.owner_id=new.owner_id and private.normalized_name(f.full_name)=private.normalized_name(new.full_name) and (
      (new.birth_date is not null and f.birth_date=new.birth_date) or
      (phone<>'' and regexp_replace(coalesce(f.contact_number,''),'[^0-9]','','g')=phone)
    ))
  ) limit 1;
  if candidate is not null then raise exception using errcode='23505',message='A matching farmer identity or RSBSA reference already exists. Ask an authorized administrator to review the existing record.'; end if;
  return new;
end; $$;
drop trigger if exists prevent_duplicate_farmer on public.farmers;
create trigger prevent_duplicate_farmer before insert or update on public.farmers for each row execute function private.prevent_duplicate_farmer();

alter table public.plantations add column if not exists gps_samples jsonb not null default '[]'::jsonb check(jsonb_typeof(gps_samples)='array' and jsonb_array_length(gps_samples)<=20000);
alter table public.plantation_boundaries add column if not exists revision integer;
alter table public.plantation_boundaries add column if not exists recorded_by uuid references auth.users(id);
alter table public.gps_tracking_sessions add column if not exists boundary_revision integer;
alter table public.gps_tracking_sessions add column if not exists boundary_geojson jsonb;
alter table public.gps_tracking_points add column if not exists sequence_no integer not null default 0;
alter table public.gps_tracking_points add column if not exists accepted boolean not null default true;
alter table public.gps_tracking_points add column if not exists exclusion_reason text;
alter table public.gps_tracking_points add constraint gps_points_finite check(accuracy<'Infinity'::double precision and isfinite(captured_at)) not valid;
create index if not exists idx_boundary_history on public.plantation_boundaries(plantation_id,recorded_at desc);
revoke insert,update,delete on public.gps_tracking_sessions,public.gps_tracking_points from authenticated;

create table if not exists public.plantation_overlap_flags (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  plantation_id uuid not null, other_plantation_id uuid not null references public.plantations(id) on delete cascade,
  overlap_sqm double precision not null check(overlap_sqm>0.01),
  created_at timestamptz not null default now(),
  unique(plantation_id,other_plantation_id),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);
create index if not exists idx_overlap_owner on public.plantation_overlap_flags(owner_id);
create table if not exists public.mapping_reviews (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
  plantation_id uuid not null,reviewed_revision integer not null,
  decision text not null check(decision in ('verified','rejected')),note text not null,
  reviewer_id uuid not null references auth.users(id),created_at timestamptz not null default now(),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);
create index if not exists idx_mapping_reviews on public.mapping_reviews(plantation_id,created_at desc);
create or replace function private.lock_mapping_change()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then perform pg_advisory_xact_lock(hashtextextended('cacao:boundary-review',0));
  elsif new.boundary is distinct from old.boundary then perform pg_advisory_xact_lock(hashtextextended('cacao:boundary-review',0)); end if;
  return new;
end; $$;
create trigger a_lock_mapping_change before insert or update on public.plantations for each row execute function private.lock_mapping_change();
alter table public.plantation_overlap_flags enable row level security;
alter table public.mapping_reviews enable row level security;
create policy overlap_scoped_read on public.plantation_overlap_flags for select to authenticated using(private.can_access(owner_id));
create policy review_scoped_read on public.mapping_reviews for select to authenticated using(private.can_access(owner_id));
revoke all on public.plantation_overlap_flags,public.mapping_reviews from anon,authenticated;
grant select on public.plantation_overlap_flags,public.mapping_reviews to authenticated;

-- Compare actual intersected surface area: touching points/edges have zero area.
create or replace function private.refresh_overlap(target uuid)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare farm public.plantations; candidate record; shared_area double precision;
begin
  perform pg_advisory_xact_lock(hashtextextended('cacao:boundary-review',0));
  select * into farm from public.plantations where id=target;
  delete from public.plantation_overlap_flags where plantation_id=target or other_plantation_id=target;
  if farm.boundary_geog is null then return; end if;
  for candidate in select id,owner_id,boundary_geog from public.plantations
    where id<>target and boundary_geog is not null and st_intersects(boundary_geog,farm.boundary_geog) loop
    shared_area=st_area(st_intersection(farm.boundary_geog,candidate.boundary_geog));
    if shared_area>0.01 then
      insert into public.plantation_overlap_flags(owner_id,plantation_id,other_plantation_id,overlap_sqm)
      values(farm.owner_id,target,candidate.id,shared_area),(candidate.owner_id,candidate.id,target,shared_area)
      on conflict(plantation_id,other_plantation_id) do update set overlap_sqm=excluded.overlap_sqm;
    end if;
  end loop;
end; $$;
revoke all on function private.refresh_overlap(uuid) from public,anon,authenticated;

create or replace function private.mapping_review_reset()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then new.verification_status='pending';
  elsif new.boundary is distinct from old.boundary or new.farmer_id is distinct from old.farmer_id or new.gps_samples is distinct from old.gps_samples or new.gps_accuracy is distinct from old.gps_accuracy then new.verification_status='pending';
  elsif new.verification_status is distinct from old.verification_status and current_user in ('authenticated','anon') then
    raise exception 'Use the mapping review workflow to record an administrator decision and review note';
  end if;
  return new;
end; $$;
drop trigger if exists z_mapping_review_reset on public.plantations;
create trigger z_mapping_review_reset before insert or update on public.plantations for each row execute function private.mapping_review_reset();

-- Keep original GPS samples separate from the edited polygon. History is append-only.
create or replace function private.audit_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_json jsonb; old_json jsonb; changed jsonb; gps_session uuid; sample record; samples jsonb;
begin
  row_json=to_jsonb(new);old_json=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  select coalesce(jsonb_agg(key),'[]'::jsonb) into changed from jsonb_each(row_json) where value is distinct from old_json->key;
  insert into public.activity_logs(owner_id,actor_id,action,record_type,record_id,details)
  values((row_json->>'owner_id')::uuid,auth.uid(),lower(tg_op),tg_table_name,(row_json->>'id')::uuid,jsonb_build_object('changed_fields',changed));
  if tg_table_name='plantations' and (tg_op='INSERT' or row_json->'boundary' is distinct from old_json->'boundary' or row_json->'gps_samples' is distinct from old_json->'gps_samples' or row_json->'gps_accuracy' is distinct from old_json->'gps_accuracy') then
    insert into public.plantation_boundaries(owner_id,plantation_id,boundary_geojson,area_sqm,capture_method,revision,recorded_by)
    values(new.owner_id,new.id,new.boundary,new.area_sqm,new.capture_method,new.revision,auth.uid());
    samples=case when jsonb_array_length(new.gps_samples)>0 then new.gps_samples else new.gps_accuracy end;
    if jsonb_typeof(samples)<>'array' or jsonb_array_length(samples)>20000 then raise exception 'Invalid GPS samples'; end if;
    if jsonb_array_length(samples)>0 then
      insert into public.gps_tracking_sessions(owner_id,plantation_id,boundary_revision,boundary_geojson)
      values(new.owner_id,new.id,new.revision,new.boundary) returning id into gps_session;
      for sample in select value,ordinality from jsonb_array_elements(samples) with ordinality loop
        insert into public.gps_tracking_points(owner_id,session_id,latitude,longitude,accuracy,captured_at,sequence_no,accepted,exclusion_reason)
        values(new.owner_id,gps_session,(sample.value->>'latitude')::double precision,(sample.value->>'longitude')::double precision,
          (sample.value->>'accuracy')::double precision,to_timestamp((sample.value->>'timestamp')::double precision/1000),
          sample.ordinality,coalesce((sample.value->>'accepted')::boolean,true),left(sample.value->>'reason',100));
      end loop;
    end if;
    perform private.refresh_overlap(new.id);
  end if;
  return new;
end; $$;

-- Privileged review checks assigned scope and locks the specific revision.
create or replace function public.review_plantation(target uuid,expected_revision integer,decision text,note text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare farm public.plantations;
begin
  if coalesce(private.user_role(),'') not in ('admin','super_admin') then raise exception 'Administrator required'; end if;
  select * into farm from public.plantations where id=target for update;
  if not found or not private.can_access(farm.owner_id) then raise exception 'Record is unavailable'; end if;
  if farm.revision<>expected_revision then raise exception using errcode='40001',message='This plantation changed. Reload before reviewing.'; end if;
  if decision not in ('verified','rejected') or char_length(trim(coalesce(note,'')))<10 then raise exception 'Choose a decision and provide a review note of at least 10 characters.'; end if;
  update public.plantations set verification_status=decision where id=target returning * into farm;
  insert into public.mapping_reviews(owner_id,plantation_id,reviewed_revision,decision,note,reviewer_id)
  values(farm.owner_id,farm.id,expected_revision,decision,trim(note),auth.uid());
  return to_jsonb(farm);
end; $$;
revoke all on function public.review_plantation(uuid,integer,text,text) from public;
grant execute on function public.review_plantation(uuid,integer,text,text) to authenticated;

-- Existing matching records are retained for manual reconciliation, never deleted.
do $$ declare item record; begin
  for item in select id from public.plantations where boundary_geog is not null loop perform private.refresh_overlap(item.id); end loop;
end $$;
commit;


-- ============================================================
-- 006_agricultural_monitoring.sql
-- ============================================================

-- Phase 2: harvests, pest inspections, maintenance, attendance and tree histories.
begin;
create table if not exists public.harvests (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  harvest_date date not null,variety text not null default 'Unspecified',harvested_pods integer not null default 0 check(harvested_pods>=0),
  wet_bean_kg numeric(12,3) not null default 0 check(wet_bean_kg between 0 and 999999999),
  dry_bean_kg numeric(12,3) not null default 0 check(dry_bean_kg between 0 and 999999999),
  estimated_value_php numeric(14,2) not null default 0 check(estimated_value_php between 0 and 999999999999),
  area_sqm_at_harvest double precision not null default 0 check(area_sqm_at_harvest>=0),
  dry_kg_per_ha double precision generated always as(dry_bean_kg::double precision*10000/nullif(area_sqm_at_harvest,0)) stored,
  recorded_by uuid not null default auth.uid() references auth.users(id),remarks text not null default '',
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(harvested_pods>0 or wet_bean_kg>0 or dry_bean_kg>0),
  check(wet_bean_kg=0 or dry_bean_kg<=wet_bean_kg),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id)
);
create index if not exists idx_harvest_farm_date on public.harvests(plantation_id,harvest_date desc);
create index if not exists idx_harvest_owner_date on public.harvests(owner_id,harvest_date desc);
create table if not exists public.pest_reports (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  observed_on date not null,pest_name text not null check(char_length(trim(pest_name)) between 1 and 200),
  severity text not null check(severity in ('low','moderate','high','critical')),
  affected_trees integer not null default 0 check(affected_trees>=0),
  resolution_status text not null default 'open' check(resolution_status in ('open','monitoring','resolved')),
  evidence_path text,remarks text not null default '',recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,owner_id),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id)
);
create table if not exists public.pest_treatments (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  pest_report_id uuid not null,treatment_date date not null,treatment text not null check(char_length(trim(treatment))>0),
  next_inspection date,remarks text not null default '',recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(next_inspection is null or next_inspection>=treatment_date),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id),
  foreign key(pest_report_id,owner_id) references public.pest_reports(id,owner_id)
);
create table if not exists public.pest_inspections (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  pest_report_id uuid not null,inspected_on date not null,findings text not null,
  resolution_status text not null check(resolution_status in ('open','monitoring','resolved')),
  severity text not null check(severity in ('low','moderate','high','critical')),
  recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id),
  foreign key(pest_report_id,owner_id) references public.pest_reports(id,owner_id)
);
create table if not exists public.plantation_tasks (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  title text not null check(char_length(trim(title)) between 1 and 200),
  task_type text not null check(task_type in ('pruning','fertilizer','irrigation','weeding','harvesting','other')),
  scheduled_on date not null,worker_id uuid,status text not null default 'planned' check(status in ('planned','in_progress','completed','cancelled')),
  completed_on date,remarks text not null default '',recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(status<>'completed' or completed_on is not null),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id),foreign key(worker_id,owner_id) references public.workers(id,owner_id)
);
create table if not exists public.maintenance_records (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  performed_on date not null,activity_type text not null check(activity_type in ('pruning','fertilizer','irrigation','weeding','other')),
  product text,quantity numeric(12,3) check(quantity between 0 and 999999999),unit text,
  remarks text not null default '',recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id)
);
create table if not exists public.worker_attendance (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,worker_id uuid not null,
  attendance_date date not null,status text not null check(status in ('present','absent','half_day')),
  hours numeric(4,2) not null default 0 check(hours between 0 and 24),remarks text not null default '',
  recorded_by uuid not null default auth.uid() references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  check(status<>'absent' or hours=0),unique(worker_id,plantation_id,attendance_date),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id),foreign key(worker_id,owner_id) references public.workers(id,owner_id)
);
create table if not exists public.tree_events (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),plantation_id uuid not null,
  event_date date not null,event_type text not null check(event_type in ('planting','mortality','replacement')),
  quantity integer not null check(quantity>0),variety text not null default 'Unspecified',age_months integer check(age_months between 0 and 1200),
  remarks text not null default '',recorded_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id)
);
alter table public.cacao_trees add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_tree_tags on public.cacao_trees(plantation_id,tag_code);
create or replace function private.validate_tree_tag()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.planted_on>current_date then raise exception 'Planting date cannot be in the future'; end if;
  if (new.latitude is null)<>(new.longitude is null) then raise exception 'Provide both tree coordinates'; end if;
  if nullif(trim(new.tag_code),'') is not null then
    perform pg_advisory_xact_lock(hashtextextended('tree-tag:'||new.plantation_id||':'||lower(trim(new.tag_code)),0));
    if exists(select 1 from public.cacao_trees where plantation_id=new.plantation_id and lower(trim(tag_code))=lower(trim(new.tag_code)) and id<>new.id) then raise exception using errcode='23505',message='This tree tag already exists in the plantation'; end if;
  end if;
  new.updated_at=now();return new;
end; $$;
create trigger validate_tree_tag before insert or update on public.cacao_trees for each row execute function private.validate_tree_tag();
create trigger protect_record before insert or update on public.cacao_trees for each row execute function private.protect_record();
create trigger audit_record after insert or update on public.cacao_trees for each row execute function private.audit_record();

-- Normalized permissions, attribution, date checks and row protection for new modules.
create or replace function private.monitor_record()
returns trigger language plpgsql set search_path='' as $$
declare values_json jsonb; event_date date; report_farm uuid; other_hours numeric;
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.owner_id<>old.owner_id or new.plantation_id<>old.plantation_id then raise exception 'Record identity and plantation cannot be changed'; end if;
    new.recorded_by=old.recorded_by;new.created_at=old.created_at;
  else new.recorded_by=auth.uid();new.created_at=now(); end if;
  new.updated_at=now();values_json=to_jsonb(new);
  event_date=coalesce((values_json->>'harvest_date')::date,(values_json->>'observed_on')::date,(values_json->>'treatment_date')::date,(values_json->>'inspected_on')::date,(values_json->>'performed_on')::date,(values_json->>'attendance_date')::date,(values_json->>'event_date')::date);
  if event_date>current_date then raise exception 'Recorded activity dates cannot be in the future'; end if;
  if tg_table_name='harvests' then
    if tg_op='INSERT' then select area_sqm into new.area_sqm_at_harvest from public.plantations where id=new.plantation_id and owner_id=new.owner_id;
    else new.area_sqm_at_harvest=old.area_sqm_at_harvest; end if;
  elsif tg_table_name in ('pest_treatments','pest_inspections') then
    select plantation_id into report_farm from public.pest_reports where id=new.pest_report_id and owner_id=new.owner_id;
    if report_farm is distinct from new.plantation_id then raise exception 'Pest report and activity must reference the same plantation'; end if;
  elsif tg_table_name='worker_attendance' then
    if not exists(select 1 from public.worker_assignments where worker_id=new.worker_id and plantation_id=new.plantation_id and owner_id=new.owner_id) then raise exception 'Assign this worker to the plantation before recording attendance'; end if;
    perform pg_advisory_xact_lock(hashtextextended('attendance:'||new.worker_id||':'||new.attendance_date,0));
    select coalesce(sum(hours),0) into other_hours from public.worker_attendance where worker_id=new.worker_id and attendance_date=new.attendance_date and id<>new.id;
    if other_hours+new.hours>24 then raise exception 'Combined daily attendance cannot exceed 24 hours'; end if;
  end if;
  return new;
end; $$;
do $$ declare t text; immutable boolean; begin
  foreach t in array array['harvests','pest_reports','pest_treatments','pest_inspections','plantation_tasks','maintenance_records','worker_attendance','tree_events'] loop
    immutable=t in ('pest_treatments','pest_inspections','maintenance_records','tree_events');
    execute format('alter table public.%I enable row level security',t);
    execute format('create index if not exists %I on public.%I(owner_id,plantation_id)', 'idx_'||t||'_scope',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select,insert on public.%I to authenticated',t);
    execute format('create policy scoped_read on public.%I for select to authenticated using(private.can_access(owner_id))',t);
    if t='worker_attendance' then
      execute format('create policy scoped_insert on public.%I for insert to authenticated with check(private.can_access(owner_id) and private.is_staff())',t);
    else execute format('create policy scoped_insert on public.%I for insert to authenticated with check(private.can_access(owner_id))',t); end if;
    if not immutable then
      execute format('grant update on public.%I to authenticated',t);
      execute format('create policy scoped_update on public.%I for update to authenticated using(private.can_access(owner_id)%s) with check(private.can_access(owner_id)%s)',t,case when t='worker_attendance' then ' and private.is_staff()' else '' end,case when t='worker_attendance' then ' and private.is_staff()' else '' end);
    end if;
    execute format('create trigger monitor_record before insert or update on public.%I for each row execute function private.monitor_record()',t);
    execute format('create trigger audit_record after insert or update on public.%I for each row execute function private.audit_record()',t);
  end loop;
end $$;
create or replace function private.apply_inspection()
returns trigger language plpgsql security definer set search_path='' as $$
declare latest public.pest_inspections;
begin
  select * into latest from public.pest_inspections where pest_report_id=new.pest_report_id order by inspected_on desc,created_at desc,id desc limit 1;
  update public.pest_reports set resolution_status=latest.resolution_status,severity=latest.severity where id=new.pest_report_id;
  return new;
end; $$;
create trigger apply_inspection after insert on public.pest_inspections for each row execute function private.apply_inspection();
commit;


-- ============================================================
-- 007_safe_sync.sql
-- ============================================================

-- Phase 3: atomic, idempotent field submissions. Run after 005 and 006.
begin;
alter table public.worker_assignments add column if not exists updated_at timestamptz not null default now();
create table if not exists public.sync_receipts (
  id uuid primary key,actor_id uuid not null references auth.users(id),entity text not null,record_id uuid not null,
  request jsonb not null,result jsonb not null,created_at timestamptz not null default now()
);
create index if not exists idx_sync_receipts_actor on public.sync_receipts(actor_id,created_at desc);
alter table public.sync_receipts enable row level security;
revoke all on public.sync_receipts from anon,authenticated;
grant select on public.sync_receipts to authenticated;
create policy own_receipts on public.sync_receipts for select to authenticated using(actor_id=(select auth.uid()) and private.can_access((result->>'owner_id')::uuid));

-- This privileged entry point explicitly repeats RLS scope checks before any DML.
-- Table/column allowlists prevent SQL injection and writes to privileged fields.
create or replace function public.apply_field_change(
  change_id uuid,entity text,record_id uuid,operation text,payload jsonb,
  expected_revision integer default null,expected_updated_at timestamptz default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;role_name text;allowed text[];mutable boolean;existing jsonb;owner uuid;
  request_json jsonb;saved jsonb;receipt public.sync_receipts;column_name text;column_list text;value_list text;set_list text;values_json jsonb;
begin
  actor=auth.uid();role_name=private.user_role();
  if actor is null or role_name is null then raise exception using errcode='42501',message='An active authenticated account is required'; end if;
  if change_id is null or record_id is null or operation is null or payload is null or operation not in ('create','update') or jsonb_typeof(payload)<>'object' then raise exception 'Invalid synchronization request'; end if;
  allowed=case entity
    when 'farmers' then array['owner_id','full_name','first_name','middle_name','last_name','gender','birth_date','contact_number','email','address','barangay','municipality','province','rsbsa_number','experience_years','category','land_tenure','variety','consent_at','photo_path']
    when 'plantations' then array['owner_id','farmer_id','name','farmer_name','barangay','municipality','province','tree_count','variety','notes','address','land_tenure','established_on','status','boundary','capture_method','gps_accuracy','gps_samples']
    when 'workers' then array['owner_id','full_name','first_name','middle_name','last_name','gender','phone','address','position','employment_type','employment_status','hired_on','notes','photo_path']
    when 'worker_assignments' then array['owner_id','worker_id','plantation_id','assigned_on','task_description']
    when 'cacao_tree_inventories' then array['owner_id','plantation_id','variety','seedling','young','mature','productive','non_productive','dead','inventory_date','remarks']
    when 'harvests' then array['owner_id','plantation_id','harvest_date','variety','harvested_pods','wet_bean_kg','dry_bean_kg','estimated_value_php','remarks']
    when 'pest_reports' then array['owner_id','plantation_id','observed_on','pest_name','severity','affected_trees','resolution_status','evidence_path','remarks']
    when 'pest_treatments' then array['owner_id','plantation_id','pest_report_id','treatment_date','treatment','next_inspection','remarks']
    when 'pest_inspections' then array['owner_id','plantation_id','pest_report_id','inspected_on','findings','resolution_status','severity']
    when 'plantation_tasks' then array['owner_id','plantation_id','title','task_type','scheduled_on','worker_id','status','completed_on','remarks']
    when 'maintenance_records' then array['owner_id','plantation_id','performed_on','activity_type','product','quantity','unit','remarks']
    when 'worker_attendance' then array['owner_id','plantation_id','worker_id','attendance_date','status','hours','remarks']
    when 'tree_events' then array['owner_id','plantation_id','event_date','event_type','quantity','variety','age_months','remarks']
    when 'cacao_trees' then array['owner_id','plantation_id','tag_code','variety','condition','planted_on','latitude','longitude','notes']
    else null end;
  if allowed is null then raise exception using errcode='42501',message='This record type cannot be synchronized'; end if;
  if entity in ('workers','worker_assignments','worker_attendance') and role_name not in ('admin','super_admin','field') then raise exception using errcode='42501',message='Staff permission required'; end if;
  mutable=entity not in ('cacao_tree_inventories','pest_treatments','pest_inspections','maintenance_records','tree_events');
  if operation='update' and not mutable then raise exception using errcode='42501',message='Historical records cannot be rewritten'; end if;
  for column_name in select jsonb_object_keys(payload) loop
    if not column_name=any(allowed) then raise exception using errcode='42501',message='The request includes a protected or unsupported field'; end if;
  end loop;
  request_json=jsonb_build_object('entity',entity,'record_id',record_id,'operation',operation,'payload',payload,'expected_revision',expected_revision,'expected_updated_at',expected_updated_at);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||change_id::text,0));
  select * into receipt from public.sync_receipts where id=change_id;
  if found then
    if receipt.actor_id<>actor or receipt.request<>request_json then raise exception using errcode='23505',message='This submission identifier is already in use for a different request'; end if;
    if not private.can_access((receipt.result->>'owner_id')::uuid) then raise exception using errcode='42501',message='Receipt is outside your current assigned scope'; end if;
    return jsonb_build_object('confirmed',true,'replayed',true,'record',receipt.result);
  end if;
  if operation='update' then
    execute format('select to_jsonb(r) from public.%I r where id=$1 for update',entity) into existing using record_id;
    if existing is null or not private.can_access((existing->>'owner_id')::uuid) then raise exception using errcode='42501',message='Record is not available to this account'; end if;
    owner=(existing->>'owner_id')::uuid;
    if entity='plantations' then
      if expected_revision is null or expected_revision<>(existing->>'revision')::integer then raise exception using errcode='40001',message='Plantation revision conflict: review both boundaries before retrying'; end if;
    elsif expected_updated_at is null or expected_updated_at is distinct from (existing->>'updated_at')::timestamptz then
      raise exception using errcode='40001',message='Record conflict: review the current server version before retrying';
    end if;
    if payload?'owner_id' and (payload->>'owner_id')::uuid<>owner then raise exception 'Record ownership cannot change'; end if;
  else
    owner=coalesce((payload->>'owner_id')::uuid,actor);
    if not private.can_access(owner) then raise exception using errcode='42501',message='Record owner is outside your assigned scope'; end if;
  end if;
  values_json=payload||jsonb_build_object('owner_id',owner);
  if operation='create' then values_json=values_json||jsonb_build_object('id',record_id); end if;
  select string_agg(format('%I',key),',' order by key),string_agg(format('input.%I',key),',' order by key),string_agg(format('%I=input.%I',key,key),',' order by key)
    into column_list,value_list,set_list from jsonb_object_keys(values_json) as k(key);
  if operation='create' then
    execute format('insert into public.%I as saved (%s) select %s from jsonb_populate_record(null::public.%I,$1) input returning to_jsonb(saved)',entity,column_list,value_list,entity) into saved using values_json;
  else
    execute format('update public.%I as saved set %s from jsonb_populate_record(null::public.%I,$1) input where saved.id=$2 returning to_jsonb(saved)',entity,set_list,entity) into saved using values_json,record_id;
  end if;
  saved=saved-'boundary_geog';
  insert into public.sync_receipts(id,actor_id,entity,record_id,request,result) values(change_id,actor,entity,record_id,request_json,saved);
  return jsonb_build_object('confirmed',true,'replayed',false,'record',saved);
end; $$;
revoke all on function public.apply_field_change(uuid,text,uuid,text,jsonb,integer,timestamptz) from public;
grant execute on function public.apply_field_change(uuid,text,uuid,text,jsonb,integer,timestamptz) to authenticated;
commit;


-- ============================================================
-- 008_farmer_feature_limits.sql
-- ============================================================

-- Apply after migrations 001-007 in the Supabase SQL Editor as postgres.
-- Restrictive policies cover table access through the authenticated API.
begin;
-- The sync RPC runs as definer, so also reject farmer writes in a trigger.
create or replace function private.require_staff_feature()
returns trigger language plpgsql set search_path='' as $$
begin
  if (select auth.uid()) is not null and not private.is_staff() then
    raise exception 'This feature is available only to staff';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.require_staff_feature() from public;
do $$ declare t text; begin
  foreach t in array array['workers','worker_assignments','worker_attendance','plantation_tasks','pest_inspections'] loop
    execute format('create policy staff_features_only on public.%I as restrictive for all to authenticated using(private.is_staff()) with check(private.is_staff())',t);
    execute format('create trigger require_staff_feature before insert or update or delete on public.%I for each row execute function private.require_staff_feature()',t);
  end loop;
end $$;
commit;


-- ============================================================
-- 009_farmer_reviews.sql
-- ============================================================

-- Apply once after 001-008. Review inbox and immutable, owner-scoped history.
begin;
create table public.farmer_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references public.farmers(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  actor_id uuid references auth.users(id) on delete set null,
  decision text not null check(decision in ('submitted','resubmitted','approved','rejected','baseline')),
  previous_status text,
  note text not null default '' check(char_length(note)<=2000),
  reviewed_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check(decision not in ('approved','rejected') or char_length(trim(note))>=10)
);
create index farmer_profile_reviews_farmer_date on public.farmer_profile_reviews(farmer_id,created_at desc);
alter table public.farmer_profile_reviews enable row level security;
revoke all on public.farmer_profile_reviews from public,anon,authenticated;
grant select on public.farmer_profile_reviews to authenticated;
create policy scoped_read on public.farmer_profile_reviews for select to authenticated using(private.can_access(owner_id));

-- Preserve shared validation, allowing correction resubmission but never self approval.
create or replace function private.protect_record()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.id<>old.id then raise exception 'Record IDs cannot be changed'; end if;
  if tg_op='UPDATE' and new.owner_id<>old.owner_id then raise exception 'Record ownership cannot be changed'; end if;
  if tg_table_name='farmers' then
    if char_length(trim(new.full_name))=0 or char_length(trim(new.first_name))=0 or char_length(trim(new.last_name))=0 or char_length(trim(coalesce(new.barangay,'')))=0 then raise exception 'Farmer name and barangay are required'; end if;
    if new.birth_date>current_date then raise exception 'Birth date cannot be in the future'; end if;
    if tg_op='INSERT' and new.registration_status<>'pending' then raise exception 'Registration must start pending'; end if;
    if tg_op='UPDATE' and new.registration_status<>old.registration_status and private.user_role() not in ('admin','super_admin')
      and not (old.registration_status='rejected' and new.registration_status='pending') then raise exception 'Only administrators may approve registrations'; end if;
    if tg_op='UPDATE' and
      (to_jsonb(new)-'updated_at'-'consent_at'-'registration_status') is distinct from (to_jsonb(old)-'updated_at'-'consent_at'-'registration_status') then
      new.registration_status='pending';
    end if;
  end if;
  return new;
end; $$;

-- Executes after protect_record and touch_record. A review event can only be
-- inserted by the scoped RPC; direct status writes cannot bypass written feedback.
create function private.guard_farmer_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  if new.registration_status is distinct from old.registration_status and new.registration_status in ('approved','rejected') then
    if old.registration_status<>'pending' or not exists (
      select 1 from public.farmer_profile_reviews r where r.farmer_id=old.id
      and r.decision=new.registration_status and r.reviewed_updated_at=old.updated_at
      and r.actor_id=auth.uid() and r.created_at>=transaction_timestamp()
    ) then raise exception 'Use the review inbox to decide a pending submission'; end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_farmer_review() from public;
create trigger zz_guard_farmer_review before update on public.farmers for each row execute function private.guard_farmer_review();

create function private.log_farmer_submission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.farmer_profile_reviews(farmer_id,owner_id,actor_id,decision,note)
    values(new.id,new.owner_id,auth.uid(),'submitted','Profile submitted for review.');
  elsif new.registration_status='pending' and
    (old.registration_status<>'pending' or (to_jsonb(new)-'updated_at'-'consent_at'-'registration_status') is distinct from (to_jsonb(old)-'updated_at'-'consent_at'-'registration_status')) then
    insert into public.farmer_profile_reviews(farmer_id,owner_id,actor_id,decision,previous_status,note,reviewed_updated_at)
    values(new.id,new.owner_id,auth.uid(),'resubmitted',old.registration_status,'Profile updated or resubmitted for review.',old.updated_at);
  end if;
  return new;
end; $$;
revoke all on function private.log_farmer_submission() from public;
create trigger log_farmer_submission after insert or update on public.farmers for each row execute function private.log_farmer_submission();

create function public.review_farmer_profile(target uuid,expected_updated_at timestamptz,decision text,note text)
returns public.farmers language plpgsql security definer set search_path='' as $$
declare farm public.farmers; clean_note text=trim(coalesce(note,''));
begin
  if coalesce(private.user_role(),'') not in ('admin','super_admin') then raise exception 'Only administrators may review profiles'; end if;
  if decision is null or decision not in ('approved','rejected') then raise exception 'Choose approve or request corrections'; end if;
  if char_length(clean_note)<10 or char_length(clean_note)>2000 then raise exception 'Provide feedback between 10 and 2000 characters'; end if;
  select * into farm from public.farmers where id=target for update;
  if not found or not private.can_access(farm.owner_id) then raise exception 'Profile unavailable or access denied'; end if;
  if expected_updated_at is null or farm.updated_at is distinct from expected_updated_at then raise exception 'This profile changed. Refresh and review the latest submission'; end if;
  if farm.registration_status<>'pending' then raise exception 'Only pending submissions can be reviewed'; end if;
  insert into public.farmer_profile_reviews(farmer_id,owner_id,actor_id,decision,previous_status,note,reviewed_updated_at)
  values(farm.id,farm.owner_id,auth.uid(),decision,farm.registration_status,clean_note,farm.updated_at);
  update public.farmers set registration_status=decision where id=target returning * into farm;
  return farm;
end; $$;

create function public.resubmit_farmer_profile(target uuid,expected_updated_at timestamptz)
returns public.farmers language plpgsql security definer set search_path='' as $$
declare farm public.farmers;
begin
  select * into farm from public.farmers where id=target for update;
  if not found or not private.can_access(farm.owner_id) then raise exception 'Profile unavailable or access denied'; end if;
  if expected_updated_at is null or farm.updated_at is distinct from expected_updated_at then raise exception 'This profile changed. Refresh before resubmitting'; end if;
  if farm.registration_status<>'rejected' then raise exception 'Only profiles needing correction can be resubmitted'; end if;
  update public.farmers set registration_status='pending' where id=target returning * into farm;
  return farm;
end; $$;
revoke all on function public.review_farmer_profile(uuid,timestamptz,text,text),public.resubmit_farmer_profile(uuid,timestamptz) from public,anon;
grant execute on function public.review_farmer_profile(uuid,timestamptz,text,text),public.resubmit_farmer_profile(uuid,timestamptz) to authenticated;

insert into public.farmer_profile_reviews(farmer_id,owner_id,decision,previous_status,note)
select id,owner_id,'baseline',registration_status,'Existing profile at review-inbox activation; earlier reviewer feedback was not recorded.' from public.farmers;
commit;


-- ============================================================
-- 010_harvest_batches.sql
-- ============================================================

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


-- ============================================================
-- 011_postharvest_learning.sql
-- ============================================================

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
   if v is null or v<0 or v>case when field in ('min_hours','turn_hours') then 1000 else 100 end then raise exception 'Enter valid agreed protocol targets';end if;
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
