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
