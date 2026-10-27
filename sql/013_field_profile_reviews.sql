-- Apply once after 001-012. Field personnel submit; administrators decide.
begin;
create table public.field_profiles (
 id uuid primary key references public.profiles(id),
 full_name text not null check(char_length(trim(full_name)) between 1 and 300),
 phone text not null check(char_length(trim(phone)) between 1 and 50),
 address text not null check(char_length(trim(address)) between 1 and 500),
 position text not null check(char_length(trim(position)) between 1 and 200),
 notes text not null default '' check(char_length(notes)<=2000),
 registration_status text not null default 'pending' check(registration_status in ('pending','approved','rejected')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp()
);
create table public.field_profile_reviews (
 id uuid primary key default gen_random_uuid(),profile_id uuid not null references public.field_profiles(id),
 actor_id uuid not null references public.profiles(id),
 decision text not null check(decision in ('submitted','resubmitted','approved','rejected')),
 note text not null check(char_length(note)<=2000),created_at timestamptz not null default clock_timestamp(),
 check(decision not in ('approved','rejected') or char_length(trim(note))>=10)
);
create index field_profile_reviews_history on public.field_profile_reviews(profile_id,created_at desc);
alter table public.field_profiles enable row level security;
alter table public.field_profile_reviews enable row level security;
revoke all on public.field_profiles,public.field_profile_reviews from public,anon,authenticated;
grant select on public.field_profiles,public.field_profile_reviews to authenticated;
create policy read_field_profiles on public.field_profiles for select to authenticated using(
 private.user_role() in ('admin','super_admin') or (private.user_role()='field' and id=auth.uid()));
create policy read_field_reviews on public.field_profile_reviews for select to authenticated using(
 private.user_role() in ('admin','super_admin') or (private.user_role()='field' and profile_id=auth.uid()));

create function public.save_field_profile(expected_updated_at timestamptz,p_payload jsonb)
returns public.field_profiles language plpgsql security definer set search_path='' as $$
declare r public.field_profiles; existing boolean;
begin
 if coalesce(private.user_role(),'')<>'field' then raise exception 'Only field personnel can submit their own staff profile';end if;
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Profile details are required';end if;
 perform pg_advisory_xact_lock(hashtextextended('field-profile:'||auth.uid(),0));
 select * into r from public.field_profiles where id=auth.uid() for update;
 existing=found;
 if (existing and (expected_updated_at is null or r.updated_at is distinct from expected_updated_at)) or
    (not existing and expected_updated_at is not null) then raise exception 'This profile changed. Refresh before saving';end if;
 if existing then
  update public.field_profiles set full_name=trim(p_payload->>'full_name'),phone=trim(p_payload->>'phone'),
   address=trim(p_payload->>'address'),position=trim(p_payload->>'position'),notes=trim(coalesce(p_payload->>'notes','')),
   registration_status='pending',updated_at=greatest(clock_timestamp(),r.updated_at+interval '1 microsecond')
   where id=auth.uid() returning * into r;
 else
  insert into public.field_profiles(id,full_name,phone,address,position,notes)
   values(auth.uid(),trim(p_payload->>'full_name'),trim(p_payload->>'phone'),trim(p_payload->>'address'),trim(p_payload->>'position'),trim(coalesce(p_payload->>'notes','')))
   returning * into r;
 end if;
 insert into public.field_profile_reviews(profile_id,actor_id,decision,note)
 values(r.id,auth.uid(),case when existing then 'resubmitted' else 'submitted' end,'Staff profile submitted for administrator review.');
 return r;
end;$$;

create function public.review_field_profile(target uuid,expected_updated_at timestamptz,decision text,note text)
returns public.field_profiles language plpgsql security definer set search_path='' as $$
declare r public.field_profiles; clean_note text=trim(coalesce(note,''));
begin
 if coalesce(private.user_role(),'') not in ('admin','super_admin') then raise exception 'Only administrators may review field profiles';end if;
 if decision is null or decision not in ('approved','rejected') then raise exception 'Choose approve or request corrections';end if;
 if char_length(clean_note) not between 10 and 2000 then raise exception 'Write feedback between 10 and 2000 characters';end if;
 perform pg_advisory_xact_lock(hashtextextended('field-profile:'||target,0));
 select * into r from public.field_profiles where id=target for update;
 if not found then raise exception 'Staff profile unavailable';end if;
 if expected_updated_at is null or r.updated_at is distinct from expected_updated_at then raise exception 'This profile changed. Refresh and review the latest submission';end if;
 if r.registration_status<>'pending' then raise exception 'Only pending submissions can be reviewed';end if;
 insert into public.field_profile_reviews(profile_id,actor_id,decision,note) values(r.id,auth.uid(),decision,clean_note);
 update public.field_profiles set registration_status=decision,updated_at=greatest(clock_timestamp(),r.updated_at+interval '1 microsecond') where id=target returning * into r;
 return r;
end;$$;
revoke all on function public.save_field_profile(timestamptz,jsonb),public.review_field_profile(uuid,timestamptz,text,text) from public,anon;
grant execute on function public.save_field_profile(timestamptz,jsonb),public.review_field_profile(uuid,timestamptz,text,text) to authenticated;
commit;
