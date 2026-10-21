-- Cacao Field Manager v1 - Supabase SQL Editor
-- Authentication records live in auth.users; public tables are owner-scoped.
-- Run entire script once. All RLS policies are created explicitly.
create extension if not exists pgcrypto;
create extension if not exists postgis;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  phone text,
  role text not null default 'farmer' check (role in ('farmer','manager','admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.farmers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  contact_number text,
  barangay text,
  municipality text,
  province text,
  created_at timestamptz not null default now(),
  unique(id,owner_id)
);

create table if not exists public.plantations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  farmer_id uuid,
  name text not null check (char_length(trim(name)) > 0),
  farmer_name text not null check (char_length(trim(farmer_name)) > 0),
  barangay text not null,
  municipality text not null,
  province text not null,
  tree_count integer not null default 0 check (tree_count >= 0),
  variety text not null default 'Unspecified',
  notes text not null default '',
  boundary jsonb,
  area_sqm double precision not null default 0 check (area_sqm >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_id),
  constraint plantation_farmer_fk foreign key (farmer_id,owner_id) references public.farmers(id,owner_id)
);

create table if not exists public.plantation_boundaries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plantation_id uuid not null,
  boundary_geojson jsonb not null,
  area_sqm double precision not null check (area_sqm >= 0),
  capture_method text not null check (capture_method in ('gps','manual','import')),
  recorded_at timestamptz not null default now(),
  constraint boundary_plantation_fk foreign key (plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);

create table if not exists public.cacao_trees (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plantation_id uuid not null,
  tag_code text,
  variety text,
  condition text not null default 'productive' check (condition in ('seedling','productive','unproductive','damaged','dead')),
  planted_on date,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  notes text,
  created_at timestamptz not null default now(),
  constraint trees_plantation_fk foreign key (plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);

create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  position text,
  employment_status text not null default 'active' check (employment_status in ('active','inactive','seasonal')),
  hired_on date,
  notes text,
  created_at timestamptz not null default now(),
  unique(id,owner_id)
);

create table if not exists public.worker_assignments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  worker_id uuid not null,
  plantation_id uuid not null,
  assigned_on date not null default current_date,
  task_description text,
  constraint assignment_worker_fk foreign key (worker_id,owner_id) references public.workers(id,owner_id) on delete cascade,
  constraint assignment_plantation_fk foreign key (plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plantation_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint activity_plantation_fk foreign key (plantation_id,owner_id) references public.plantations(id,owner_id) on delete cascade
);

-- Supabase rows remain private per authenticated account.
alter table public.profiles enable row level security;
alter table public.farmers enable row level security;
alter table public.plantations enable row level security;
alter table public.plantation_boundaries enable row level security;
alter table public.cacao_trees enable row level security;
alter table public.workers enable row level security;
alter table public.worker_assignments enable row level security;
alter table public.activity_logs enable row level security;

-- No admin bypass is granted by editable profile.role.
-- Ordinary authenticated users only access records they own.
drop policy if exists profiles_owner on public.profiles;
create policy profiles_owner on public.profiles for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

do $$
declare t text;
begin
  foreach t in array array['farmers','plantations','plantation_boundaries','cacao_trees','workers','worker_assignments','activity_logs'] loop
    execute format('drop policy if exists owner_crud on public.%I',t);
    execute format('create policy owner_crud on public.%I for all to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))',t);
  end loop;
end $$;

-- DB API permissions (RLS is still enforced)
grant usage on schema public to authenticated;
grant select,insert,update,delete on public.profiles, public.farmers, public.plantations,
 public.plantation_boundaries, public.cacao_trees, public.workers,
 public.worker_assignments, public.activity_logs to authenticated;

-- Optional: automatically provision a profile for new users.
create or replace function public.new_user_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name) values(new.id, coalesce(new.raw_user_meta_data ->> 'full_name','')) on conflict(id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created_cacao on auth.users;
create trigger on_auth_user_created_cacao after insert on auth.users for each row execute function public.new_user_profile();

create index if not exists idx_plantations_owner on public.plantations(owner_id);
create index if not exists idx_workers_owner on public.workers(owner_id);
create index if not exists idx_trees_plantation on public.cacao_trees(plantation_id);
create index if not exists idx_assignments_plantation on public.worker_assignments(plantation_id);
