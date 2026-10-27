-- Apply once after 001-011. Preserve scoped reads and farmer process observations.
begin;
create function private.require_admin_process_action()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and coalesce(private.user_role(),'') not in ('admin','super_admin') then
    if tg_table_name='postharvest_records' then
      if new.kind not in ('fermentation','drying') then
        raise exception 'Only administrators can record protocols, quality assessments, handovers and costs';
      end if;
    elsif new.stage in ('quality_check','stored','sold') then
      raise exception 'Only administrators can record quality decisions, storage and sales';
    end if;
  end if;
  return new;
end;$$;
revoke all on function private.require_admin_process_action() from public;
-- Triggers also enforce permissions inside security-definer RPC calls.
create trigger require_admin_process_action before insert or update on public.postharvest_records
for each row execute function private.require_admin_process_action();
create trigger require_admin_process_action before insert or update on public.harvest_batches
for each row execute function private.require_admin_process_action();
commit;
