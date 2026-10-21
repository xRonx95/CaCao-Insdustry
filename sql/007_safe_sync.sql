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
