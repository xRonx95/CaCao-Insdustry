-- Apply once after 001-013. Admins no longer require farmer assignments.
begin;
create or replace function private.can_access(target uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.user_role() is not null and (
  target=(select auth.uid()) or private.user_role() in ('admin','super_admin') or
  (private.user_role()='field' and exists (
   select 1 from public.staff_farmer_assignments where staff_id=(select auth.uid()) and farmer_owner_id=target
  ))),false);
$$;
-- Populate administrator farmer pickers, including accounts with no records yet.
drop policy profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using(
 id=(select auth.uid()) or private.user_role()='super_admin' or
 (private.user_role()='admin' and role in ('farmer','field'))
);
-- Roles, account status, invitations and assignments remain super-admin managed.
commit;
