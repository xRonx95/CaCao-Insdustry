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
