-- Run after 001_schema.sql, including on existing installations.
-- Admin authority uses app_metadata, which ordinary accounts cannot edit.
begin;

drop policy if exists admin_plantations on public.plantations;
create policy admin_plantations on public.plantations
  for all to authenticated
  using ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin')
  with check ((select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

commit;

-- Assign an admin using the Supabase SQL Editor (replace the email):
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
--   || '{"role":"admin"}'::jsonb
-- where email = 'admin@example.com';
-- Sign out and sign back in after assigning or removing the role.
