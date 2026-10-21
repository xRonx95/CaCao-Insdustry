-- CACAO INDUSTRY: UPGRADE FROM 004 TO 007
-- Only for projects with 001 through 004 already successfully installed.
-- Back up first. Test in staging. Apply once; do not rerun installed migrations.
-- If any part of 005-007 is already installed, use only the pending numbered files.

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
