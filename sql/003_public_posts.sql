-- Run after 001_schema.sql and 002_admin_access.sql in Supabase SQL Editor.
-- Only posts and their uploaded photos are public; plantation records stay private.
begin;

create table if not exists public.cacao_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  farmer_name text not null check (char_length(trim(farmer_name)) between 1 and 120),
  caption text not null default '' check (char_length(caption) <= 2000),
  image_path text,
  created_at timestamptz not null default now(),
  constraint cacao_post_content check (char_length(trim(caption)) > 0 or image_path is not null),
  constraint cacao_post_image_owner check (
    image_path is null or image_path ~ (
      '^' || owner_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$'
    )
  )
);

alter table public.cacao_posts enable row level security;
drop policy if exists cacao_posts_public_read on public.cacao_posts;
create policy cacao_posts_public_read on public.cacao_posts
  for select to anon, authenticated using (true);

drop policy if exists cacao_posts_owner_insert on public.cacao_posts;
create policy cacao_posts_owner_insert on public.cacao_posts
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), 'farmer') <> 'admin'
  );

-- No client update policy: published posts cannot be reassigned or rewritten.
grant usage on schema public to anon;
grant select on public.cacao_posts to anon, authenticated;
grant insert on public.cacao_posts to authenticated;

create index if not exists idx_cacao_posts_feed
  on public.cacao_posts(created_at desc, id desc);
create index if not exists idx_cacao_posts_owner on public.cacao_posts(owner_id);

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cacao-posts', 'cacao-posts', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp'])
on conflict(id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists cacao_photos_owner_upload on storage.objects;
create policy cacao_photos_owner_upload on storage.objects
  for insert to authenticated with check (
    bucket_id = 'cacao-posts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), 'farmer') <> 'admin'
  );

-- Owners may read object metadata and clean up photos if post creation fails.
drop policy if exists cacao_photos_owner_select on storage.objects;
create policy cacao_photos_owner_select on storage.objects
  for select to authenticated using (
    bucket_id = 'cacao-posts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists cacao_photos_unused_delete on storage.objects;
create policy cacao_photos_unused_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'cacao-posts'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.cacao_posts p where p.image_path = storage.objects.name
    )
  );

commit;
