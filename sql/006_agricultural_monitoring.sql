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
