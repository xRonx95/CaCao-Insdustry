-- Apply once after 001-008. Review inbox and immutable, owner-scoped history.
begin;
create table public.farmer_profile_reviews (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references public.farmers(id) on delete cascade,
  owner_id uuid not null references auth.users(id),
  actor_id uuid references auth.users(id) on delete set null,
  decision text not null check(decision in ('submitted','resubmitted','approved','rejected','baseline')),
  previous_status text,
  note text not null default '' check(char_length(note)<=2000),
  reviewed_updated_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check(decision not in ('approved','rejected') or char_length(trim(note))>=10)
);
create index farmer_profile_reviews_farmer_date on public.farmer_profile_reviews(farmer_id,created_at desc);
alter table public.farmer_profile_reviews enable row level security;
revoke all on public.farmer_profile_reviews from public,anon,authenticated;
grant select on public.farmer_profile_reviews to authenticated;
create policy scoped_read on public.farmer_profile_reviews for select to authenticated using(private.can_access(owner_id));

-- Preserve shared validation, allowing correction resubmission but never self approval.
create or replace function private.protect_record()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and new.id<>old.id then raise exception 'Record IDs cannot be changed'; end if;
  if tg_op='UPDATE' and new.owner_id<>old.owner_id then raise exception 'Record ownership cannot be changed'; end if;
  if tg_table_name='farmers' then
    if char_length(trim(new.full_name))=0 or char_length(trim(new.first_name))=0 or char_length(trim(new.last_name))=0 or char_length(trim(coalesce(new.barangay,'')))=0 then raise exception 'Farmer name and barangay are required'; end if;
    if new.birth_date>current_date then raise exception 'Birth date cannot be in the future'; end if;
    if tg_op='INSERT' and new.registration_status<>'pending' then raise exception 'Registration must start pending'; end if;
    if tg_op='UPDATE' and new.registration_status<>old.registration_status and private.user_role() not in ('admin','super_admin')
      and not (old.registration_status='rejected' and new.registration_status='pending') then raise exception 'Only administrators may approve registrations'; end if;
    if tg_op='UPDATE' and
      (to_jsonb(new)-'updated_at'-'consent_at'-'registration_status') is distinct from (to_jsonb(old)-'updated_at'-'consent_at'-'registration_status') then
      new.registration_status='pending';
    end if;
  end if;
  return new;
end; $$;

-- Executes after protect_record and touch_record. A review event can only be
-- inserted by the scoped RPC; direct status writes cannot bypass written feedback.
create function private.guard_farmer_review()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.updated_at=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  if new.registration_status is distinct from old.registration_status and new.registration_status in ('approved','rejected') then
    if old.registration_status<>'pending' or not exists (
      select 1 from public.farmer_profile_reviews r where r.farmer_id=old.id
      and r.decision=new.registration_status and r.reviewed_updated_at=old.updated_at
      and r.actor_id=auth.uid() and r.created_at>=transaction_timestamp()
    ) then raise exception 'Use the review inbox to decide a pending submission'; end if;
  end if;
  return new;
end; $$;
revoke all on function private.guard_farmer_review() from public;
create trigger zz_guard_farmer_review before update on public.farmers for each row execute function private.guard_farmer_review();

create function private.log_farmer_submission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    insert into public.farmer_profile_reviews(farmer_id,owner_id,actor_id,decision,note)
    values(new.id,new.owner_id,auth.uid(),'submitted','Profile submitted for review.');
  elsif new.registration_status='pending' and
    (old.registration_status<>'pending' or (to_jsonb(new)-'updated_at'-'consent_at'-'registration_status') is distinct from (to_jsonb(old)-'updated_at'-'consent_at'-'registration_status')) then
    insert into public.farmer_profile_reviews(farmer_id,owner_id,actor_id,decision,previous_status,note,reviewed_updated_at)
    values(new.id,new.owner_id,auth.uid(),'resubmitted',old.registration_status,'Profile updated or resubmitted for review.',old.updated_at);
  end if;
  return new;
end; $$;
revoke all on function private.log_farmer_submission() from public;
create trigger log_farmer_submission after insert or update on public.farmers for each row execute function private.log_farmer_submission();

create function public.review_farmer_profile(target uuid,expected_updated_at timestamptz,decision text,note text)
returns public.farmers language plpgsql security definer set search_path='' as $$
declare farm public.farmers; clean_note text=trim(coalesce(note,''));
begin
  if coalesce(private.user_role(),'') not in ('admin','super_admin') then raise exception 'Only administrators may review profiles'; end if;
  if decision is null or decision not in ('approved','rejected') then raise exception 'Choose approve or request corrections'; end if;
  if char_length(clean_note)<10 or char_length(clean_note)>2000 then raise exception 'Provide feedback between 10 and 2000 characters'; end if;
  select * into farm from public.farmers where id=target for update;
  if not found or not private.can_access(farm.owner_id) then raise exception 'Profile unavailable or access denied'; end if;
  if expected_updated_at is null or farm.updated_at is distinct from expected_updated_at then raise exception 'This profile changed. Refresh and review the latest submission'; end if;
  if farm.registration_status<>'pending' then raise exception 'Only pending submissions can be reviewed'; end if;
  insert into public.farmer_profile_reviews(farmer_id,owner_id,actor_id,decision,previous_status,note,reviewed_updated_at)
  values(farm.id,farm.owner_id,auth.uid(),decision,farm.registration_status,clean_note,farm.updated_at);
  update public.farmers set registration_status=decision where id=target returning * into farm;
  return farm;
end; $$;

create function public.resubmit_farmer_profile(target uuid,expected_updated_at timestamptz)
returns public.farmers language plpgsql security definer set search_path='' as $$
declare farm public.farmers;
begin
  select * into farm from public.farmers where id=target for update;
  if not found or not private.can_access(farm.owner_id) then raise exception 'Profile unavailable or access denied'; end if;
  if expected_updated_at is null or farm.updated_at is distinct from expected_updated_at then raise exception 'This profile changed. Refresh before resubmitting'; end if;
  if farm.registration_status<>'rejected' then raise exception 'Only profiles needing correction can be resubmitted'; end if;
  update public.farmers set registration_status='pending' where id=target returning * into farm;
  return farm;
end; $$;
revoke all on function public.review_farmer_profile(uuid,timestamptz,text,text),public.resubmit_farmer_profile(uuid,timestamptz) from public,anon;
grant execute on function public.review_farmer_profile(uuid,timestamptz,text,text),public.resubmit_farmer_profile(uuid,timestamptz) to authenticated;

insert into public.farmer_profile_reviews(farmer_id,owner_id,decision,previous_status,note)
select id,owner_id,'baseline',registration_status,'Existing profile at review-inbox activation; earlier reviewer feedback was not recorded.' from public.farmers;
commit;
