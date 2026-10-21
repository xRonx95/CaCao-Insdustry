-- Incremental platform migration. Back up existing data; run after 001-003.
-- PostGIS can live in public or extensions; never move an existing extension.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

alter table public.profiles drop constraint if exists profiles_role_check;
update public.profiles set role = 'field' where role = 'manager';
alter table public.profiles add constraint profiles_role_check check (role in ('farmer','field','admin','super_admin'));
alter table public.profiles add column if not exists account_status text not null default 'active' check (account_status in ('active','suspended'));
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
insert into public.profiles(id,display_name,role)
select id, coalesce(raw_user_meta_data->>'full_name',''),
  case when raw_app_meta_data->>'role' in ('admin','super_admin','field') then raw_app_meta_data->>'role' else 'farmer' end
from auth.users on conflict(id) do nothing;
-- Preserve earlier trusted admin assignments during this upgrade.
update public.profiles p set role = u.raw_app_meta_data->>'role'
from auth.users u where p.id=u.id and u.raw_app_meta_data->>'role' in ('admin','super_admin','field');

create table if not exists public.staff_farmer_assignments (
  staff_id uuid not null references public.profiles(id) on delete cascade,
  farmer_owner_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(staff_id,farmer_owner_id)
);
create index if not exists idx_staff_farmer_owner on public.staff_farmer_assignments(farmer_owner_id);

create or replace function private.user_role()
returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=(select auth.uid()) and account_status='active';
$$;
create or replace function private.can_access(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.user_role() is not null and (
    target=(select auth.uid()) or private.user_role()='super_admin' or
    (private.user_role() in ('admin','field') and exists (
      select 1 from public.staff_farmer_assignments where staff_id=(select auth.uid()) and farmer_owner_id=target
    ))),false);
$$;
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.user_role() in ('admin','super_admin','field'),false);
$$;
revoke all on function private.user_role(),private.can_access(uuid),private.is_staff() from public;
grant execute on function private.user_role(),private.can_access(uuid),private.is_staff() to authenticated;

alter table public.farmers add column if not exists first_name text not null default '';
alter table public.farmers add column if not exists middle_name text not null default '';
alter table public.farmers add column if not exists last_name text not null default '';
alter table public.farmers add column if not exists gender text;
alter table public.farmers add column if not exists birth_date date;
alter table public.farmers add column if not exists email text;
alter table public.farmers add column if not exists address text;
alter table public.farmers add column if not exists rsbsa_number text;
alter table public.farmers add column if not exists experience_years integer check(experience_years between 0 and 100);
alter table public.farmers add column if not exists category text not null default 'Smallholder';
alter table public.farmers add column if not exists land_tenure text not null default 'Owner';
alter table public.farmers add column if not exists variety text not null default 'Unspecified';
alter table public.farmers add column if not exists photo_path text;
alter table public.farmers add column if not exists registration_status text not null default 'pending' check(registration_status in ('pending','approved','rejected'));
alter table public.farmers add column if not exists consent_at timestamptz;
alter table public.farmers add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_farmers_owner on public.farmers(owner_id);
create index if not exists idx_farmers_status_barangay on public.farmers(registration_status,barangay);

alter table public.plantations add column if not exists address text;
alter table public.plantations add column if not exists land_tenure text not null default 'Owner';
alter table public.plantations add column if not exists established_on date;
alter table public.plantations add column if not exists status text not null default 'active' check(status in ('active','inactive','rehabilitation'));
alter table public.plantations add column if not exists verification_status text not null default 'pending' check(verification_status in ('pending','verified','rejected'));
alter table public.plantations add column if not exists revision integer not null default 1;
alter table public.plantations add column if not exists gps_accuracy jsonb not null default '[]';
alter table public.plantations add column if not exists capture_method text not null default 'manual' check(capture_method in ('manual','gps','import'));
-- Geography type is qualified dynamically to support either PostGIS schema.
do $$ declare ext text; begin
  select n.nspname into ext from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='postgis';
  if ext is null then raise exception 'Enable the PostGIS extension before running 004_platform.sql'; end if;
  execute format('alter table public.plantations add column if not exists boundary_geog %I.geography(Polygon,4326)',ext);
end $$;

alter table public.workers add column if not exists first_name text not null default '';
alter table public.workers add column if not exists middle_name text not null default '';
alter table public.workers add column if not exists last_name text not null default '';
alter table public.workers add column if not exists gender text;
alter table public.workers add column if not exists address text;
alter table public.workers add column if not exists employment_type text not null default 'Regular';
alter table public.workers add column if not exists photo_path text;
alter table public.workers add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_workers_owner_status on public.workers(owner_id,employment_status);

create table if not exists public.cacao_tree_inventories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  plantation_id uuid not null,
  variety text not null default 'Unspecified',
  seedling integer not null default 0 check(seedling>=0),
  young integer not null default 0 check(young>=0),
  mature integer not null default 0 check(mature>=0),
  productive integer not null default 0 check(productive>=0),
  non_productive integer not null default 0 check(non_productive>=0),
  dead integer not null default 0 check(dead>=0),
  total_trees integer generated always as(seedling+young+mature+dead) stored,
  inventory_date date not null default current_date,
  recorded_by uuid not null default auth.uid() references auth.users(id),
  remarks text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(productive+non_productive=mature),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);
create index if not exists idx_inventory_plantation_date on public.cacao_tree_inventories(plantation_id,inventory_date desc,created_at desc);

create table if not exists public.gps_tracking_sessions (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  plantation_id uuid not null, status text not null default 'completed' check(status in ('completed','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,owner_id), foreign key(plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);
create table if not exists public.gps_tracking_points (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
  session_id uuid not null, latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy double precision not null check(accuracy>=0), captured_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(session_id,owner_id) references public.gps_tracking_sessions(id,owner_id) on delete cascade
);
create index if not exists idx_gps_points_session on public.gps_tracking_points(session_id);

create table if not exists public.farmer_documents (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
  farmer_id uuid not null,path text not null,label text not null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(farmer_id,owner_id) references public.farmers(id,owner_id) on delete cascade
);
create table if not exists public.plantation_photos (
  id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),
  plantation_id uuid not null,path text not null,caption text not null default '',
  latitude double precision check(latitude between -90 and 90),longitude double precision check(longitude between -180 and 180),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  foreign key(plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);
alter table public.activity_logs add column if not exists actor_id uuid references auth.users(id);
alter table public.activity_logs add column if not exists record_type text;
alter table public.activity_logs add column if not exists record_id uuid;
create index if not exists idx_activity_owner_created on public.activity_logs(owner_id,created_at desc);

-- Replace legacy permissive policies. Role decisions use protected DB profiles.
do $$ declare t text; p record; begin
  foreach t in array array['profiles','farmers','plantations','plantation_boundaries','cacao_trees','workers','worker_assignments','activity_logs','staff_farmer_assignments','gps_tracking_sessions','gps_tracking_points','cacao_tree_inventories','farmer_documents','plantation_photos'] loop
    execute format('alter table public.%I enable row level security',t);
    for p in select policyname from pg_policies where schemaname='public' and tablename=t loop
      execute format('drop policy %I on public.%I',p.policyname,t);
    end loop;
  end loop;
end $$;

create policy profiles_read on public.profiles for select to authenticated using(id=(select auth.uid()) or private.user_role()='super_admin');
create policy profiles_edit on public.profiles for update to authenticated using(id=(select auth.uid()) and private.user_role() is not null) with check(id=(select auth.uid()));
revoke all on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update(display_name,phone) on public.profiles to authenticated;
create policy assignments_read on public.staff_farmer_assignments for select to authenticated using(staff_id=(select auth.uid()) or private.user_role()='super_admin');
create policy assignments_write on public.staff_farmer_assignments for all to authenticated using(private.user_role()='super_admin') with check(private.user_role()='super_admin');

do $$ declare t text; begin
  foreach t in array array['farmers','plantations','cacao_trees','gps_tracking_sessions','gps_tracking_points','farmer_documents','plantation_photos'] loop
    execute format('create policy scoped_read on public.%I for select to authenticated using(private.can_access(owner_id))',t);
    execute format('create policy scoped_insert on public.%I for insert to authenticated with check(private.can_access(owner_id))',t);
    execute format('create policy scoped_update on public.%I for update to authenticated using(private.can_access(owner_id)) with check(private.can_access(owner_id))',t);
  end loop;
  foreach t in array array['workers','worker_assignments'] loop
    execute format('create policy scoped_read on public.%I for select to authenticated using(private.can_access(owner_id))',t);
    execute format('create policy staff_write on public.%I for all to authenticated using(private.can_access(owner_id) and private.is_staff()) with check(private.can_access(owner_id) and private.is_staff())',t);
  end loop;
end $$;
create policy inventory_read on public.cacao_tree_inventories for select to authenticated using(private.can_access(owner_id));
create policy inventory_insert on public.cacao_tree_inventories for insert to authenticated with check(private.can_access(owner_id) and recorded_by=(select auth.uid()));
create policy boundaries_read on public.plantation_boundaries for select to authenticated using(private.can_access(owner_id));
create policy logs_read on public.activity_logs for select to authenticated using(private.can_access(owner_id));
revoke insert,update,delete on public.activity_logs,public.plantation_boundaries from authenticated;
revoke all on public.cacao_tree_inventories from authenticated;
grant select,insert on public.cacao_tree_inventories to authenticated;
grant select,insert,update on public.staff_farmer_assignments,public.gps_tracking_sessions,public.gps_tracking_points,public.farmer_documents,public.plantation_photos to authenticated;
grant delete on public.staff_farmer_assignments to authenticated;

create or replace function private.touch_record()
returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end; $$;
create or replace function private.protect_record()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.id<>old.id then raise exception 'Record IDs cannot be changed'; end if;
  if tg_op='UPDATE' and new.owner_id<>old.owner_id then raise exception 'Record ownership cannot be changed'; end if;
  if tg_table_name='farmers' then
    if char_length(trim(new.full_name))=0 or char_length(trim(new.first_name))=0 or char_length(trim(new.last_name))=0 or char_length(trim(coalesce(new.barangay,'')))=0 then raise exception 'Farmer name and barangay are required'; end if;
    if new.birth_date>current_date then raise exception 'Birth date cannot be in the future'; end if;
    if tg_op='INSERT' and new.registration_status<>'pending' and private.user_role() not in ('admin','super_admin') then raise exception 'Registration must start pending'; end if;
    if tg_op='UPDATE' and new.registration_status<>old.registration_status and private.user_role() not in ('admin','super_admin') then raise exception 'Only administrators may approve registrations'; end if;
    if tg_op='UPDATE' and private.user_role() not in ('admin','super_admin') and
      (to_jsonb(new)-'updated_at'-'consent_at'-'registration_status') is distinct from (to_jsonb(old)-'updated_at'-'consent_at'-'registration_status') then
      new.registration_status='pending';
    end if;
  end if;
  return new;
end; $$;
do $$ declare t text; begin
  foreach t in array array['farmers','plantations','workers','worker_assignments','gps_tracking_sessions','gps_tracking_points','farmer_documents','plantation_photos'] loop
    execute format('drop trigger if exists protect_record on public.%I',t);
    execute format('create trigger protect_record before insert or update on public.%I for each row execute function private.protect_record()',t);
  end loop;
  foreach t in array array['profiles','farmers','workers','plantations','gps_tracking_sessions','farmer_documents','plantation_photos'] loop
    execute format('drop trigger if exists touch_record on public.%I',t);
    execute format('create trigger touch_record before update on public.%I for each row execute function private.touch_record()',t);
  end loop;
end $$;

create or replace function private.protect_inventory()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.inventory_date>current_date then raise exception 'Inventory date cannot be in the future'; end if;
  new.created_at=now(); new.updated_at=now(); new.recorded_by=auth.uid();
  return new;
end; $$;
drop trigger if exists protect_inventory on public.cacao_tree_inventories;
create trigger protect_inventory before insert on public.cacao_tree_inventories for each row execute function private.protect_inventory();

-- Authoritative geometry validation, area and revision tracking, independent of client totals.
create or replace function private.validate_plantation()
returns trigger language plpgsql set search_path=public,extensions,pg_temp as $$
declare g geometry; center geometry;
begin
  if new.boundary is null then raise exception 'A plantation boundary is required'; end if;
  if new.boundary->>'type'<>'Polygon' then raise exception 'Only Polygon boundaries are supported'; end if;
  g=st_setsrid(st_geomfromgeojson(new.boundary::text),4326);
  if st_geometrytype(g)<>'ST_Polygon' or st_isempty(g) or not st_isvalid(g) or st_npoints(g)<4 then
    raise exception 'Invalid or self-intersecting plantation boundary';
  end if;
  if st_xmin(box3d(g)) < -180 or st_xmax(box3d(g)) > 180 or st_ymin(box3d(g)) < -90 or st_ymax(box3d(g)) > 90 then
    raise exception 'Coordinates are outside valid longitude/latitude ranges';
  end if;
  new.boundary_geog=g::geography;
  new.area_sqm=st_area(new.boundary_geog);
  if new.area_sqm<=0 then raise exception 'Boundary must enclose a positive area'; end if;
  if tg_op='UPDATE' then
    if new.revision<>old.revision then raise exception 'Revision is server managed'; end if;
    new.revision=old.revision+1;
    if new.verification_status<>old.verification_status and private.user_role() not in ('admin','super_admin') then raise exception 'Only administrators may verify plantations'; end if;
    if private.user_role() not in ('admin','super_admin') and (new.boundary is distinct from old.boundary or new.farmer_id is distinct from old.farmer_id) then new.verification_status='pending'; end if;
  else
    new.revision=1;
    if private.user_role() not in ('admin','super_admin') then new.verification_status='pending'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists validate_plantation on public.plantations;
create trigger validate_plantation before insert or update on public.plantations for each row execute function private.validate_plantation();
create index if not exists idx_plantations_geog on public.plantations using gist(boundary_geog);

-- Populate geographic data for existing valid boundaries without discarding bad legacy rows.
do $$ declare r record; begin
  for r in select id from public.plantations where boundary is not null and boundary_geog is null loop
    begin
      update public.plantations set boundary=boundary where id=r.id;
    exception when others then
      raise warning 'Legacy plantation % needs boundary review: %',r.id,sqlerrm;
    end;
  end loop;
end $$;

-- Append-only audit history stores changed field names, not copies of sensitive data.
create or replace function private.audit_record()
returns trigger language plpgsql security definer set search_path='' as $$
declare row_json jsonb; old_json jsonb; changed jsonb; gps_session uuid; point jsonb;
begin
  row_json=to_jsonb(new); old_json=case when tg_op='UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  select coalesce(jsonb_agg(key),'[]'::jsonb) into changed from jsonb_each(row_json) where value is distinct from old_json->key;
  insert into public.activity_logs(owner_id,actor_id,action,record_type,record_id,details)
  values((row_json->>'owner_id')::uuid,auth.uid(),lower(tg_op),tg_table_name,(row_json->>'id')::uuid,jsonb_build_object('changed_fields',changed));
  if tg_table_name='plantations' and (tg_op='INSERT' or row_json->'boundary' is distinct from old_json->'boundary') then
    insert into public.plantation_boundaries(owner_id,plantation_id,boundary_geojson,area_sqm,capture_method)
    values(new.owner_id,new.id,new.boundary,new.area_sqm,new.capture_method);
    if new.capture_method='gps' and jsonb_array_length(new.gps_accuracy)>0 then
      if jsonb_array_length(new.gps_accuracy)>10000 then raise exception 'GPS point limit exceeded'; end if;
      insert into public.gps_tracking_sessions(owner_id,plantation_id) values(new.owner_id,new.id) returning id into gps_session;
      for point in select * from jsonb_array_elements(new.gps_accuracy) loop
        insert into public.gps_tracking_points(owner_id,session_id,latitude,longitude,accuracy,captured_at)
        values(new.owner_id,gps_session,(point->>'latitude')::double precision,(point->>'longitude')::double precision,
          (point->>'accuracy')::double precision,to_timestamp((point->>'timestamp')::double precision/1000));
      end loop;
    end if;
  end if;
  return new;
end; $$;
do $$ declare t text; begin
  foreach t in array array['farmers','plantations','workers','worker_assignments','cacao_tree_inventories'] loop
    execute format('drop trigger if exists audit_record on public.%I',t);
    execute format('create trigger audit_record after insert or update on public.%I for each row execute function private.audit_record()',t);
  end loop;
end $$;

-- Inventory records are immutable; latest inventory controls the farm total.
create or replace function private.inventory_total()
returns trigger language plpgsql security definer set search_path='' as $$
declare latest_count integer;
begin
  select total_trees into latest_count from public.cacao_tree_inventories where plantation_id=new.plantation_id
  order by inventory_date desc,created_at desc,id desc limit 1;
  update public.plantations set tree_count=latest_count where id=new.plantation_id;
  return new;
end; $$;
drop trigger if exists inventory_total on public.cacao_tree_inventories;
create trigger inventory_total after insert on public.cacao_tree_inventories for each row execute function private.inventory_total();

create or replace function public.set_account_access(target uuid,new_role text,new_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if private.user_role()<>'super_admin' or private.user_role() is null then raise exception 'Super administrator required'; end if;
  if target=auth.uid() then raise exception 'You cannot change your own access'; end if;
  if new_role not in ('farmer','field','admin','super_admin') or new_status not in ('active','suspended') then raise exception 'Invalid account access'; end if;
  update public.profiles set role=new_role,account_status=new_status where id=target;
  if not found then raise exception 'Account not found'; end if;
  update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('role',new_role) where id=target;
  insert into public.activity_logs(owner_id,actor_id,action,record_type,record_id,details)
  values(target,auth.uid(),'account_access','profiles',target,jsonb_build_object('role',new_role,'status',new_status));
end; $$;
revoke all on function public.set_account_access(uuid,text,text) from public;
grant execute on function public.set_account_access(uuid,text,text) to authenticated;

create or replace function public.new_user_profile()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,display_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'farmer');
  return new;
end; $$;

create or replace function private.audit_staff_access()
returns trigger language plpgsql security definer set search_path='' as $$
declare changed_row jsonb;
begin
  changed_row=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  insert into public.activity_logs(owner_id,actor_id,action,record_type,record_id,details)
  values((changed_row->>'farmer_owner_id')::uuid,auth.uid(),lower(tg_op),'staff_farmer_assignments',
    (changed_row->>'farmer_owner_id')::uuid,jsonb_build_object('staff_id',changed_row->>'staff_id'));
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
drop trigger if exists audit_staff_access on public.staff_farmer_assignments;
create trigger audit_staff_access after insert or update or delete on public.staff_farmer_assignments for each row execute function private.audit_staff_access();

-- Private farm media. Signed URLs are used by authorized record viewers.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('farm-private','farm-private',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists private_media_read on storage.objects;
create policy private_media_read on storage.objects for select to authenticated
using(bucket_id='farm-private' and private.can_access(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end));
drop policy if exists private_media_upload on storage.objects;
create policy private_media_upload on storage.objects for insert to authenticated
with check(bucket_id='farm-private' and private.can_access(case when (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$' then ((storage.foldername(name))[1])::uuid end));

-- Public feed remains public; suspended accounts cannot publish or upload.
drop policy if exists cacao_posts_owner_insert on public.cacao_posts;
create policy cacao_posts_owner_insert on public.cacao_posts for insert to authenticated
with check(owner_id=(select auth.uid()) and private.user_role()='farmer');
drop policy if exists cacao_photos_owner_upload on storage.objects;
create policy cacao_photos_owner_upload on storage.objects for insert to authenticated
with check(bucket_id='cacao-posts' and (storage.foldername(name))[1]=(select auth.uid())::text and private.user_role()='farmer');
commit;

-- Bootstrap the first super admin manually in the SQL Editor, never in browser JS:
-- update public.profiles set role='super_admin' where id=(select id from auth.users where email='YOUR_EMAIL');
-- update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}')||'{"role":"super_admin"}' where email='YOUR_EMAIL';
-- Sign out and sign back in. Super admins assign staff to farmer accounts in Users.
