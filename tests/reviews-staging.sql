-- STAGING ONLY after migrations 001-009. Fixtures and decisions roll back.
begin;
create temp table review_test_ids(label text primary key,id uuid default gen_random_uuid());
insert into review_test_ids(label) values('farmer'),('other'),('admin'),('field'),('profile');
grant select on review_test_ids to authenticated;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'review-test-'||id||'@example.invalid','authenticated','authenticated','{}','{}',now(),now()
from review_test_ids where label<>'profile';
update public.profiles set role='admin' where id=(select id from review_test_ids where label='admin');
update public.profiles set role='field' where id=(select id from review_test_ids where label='field');
insert into public.farmers(id,owner_id,full_name,first_name,last_name,barangay,consent_at)
select p.id,f.id,'Review Test Farmer','Review','Farmer','Test',now() from review_test_ids p,review_test_ids f where p.label='profile' and f.label='farmer';
insert into public.staff_farmer_assignments(staff_id,farmer_owner_id)
select s.id,f.id from review_test_ids s,review_test_ids f where s.label='field' and f.label='farmer';

-- Unassigned administrator cannot review or see history.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from review_test_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare denied boolean=false; begin
  if exists(select 1 from public.farmer_profile_reviews) then raise exception 'FAIL: unassigned history visible'; end if;
  begin perform public.review_farmer_profile((select id from review_test_ids where label='profile'),now(),'approved','Reviewed and approved.'); exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: unassigned approval'; end if;
end $$;
reset role;
insert into public.staff_farmer_assignments(staff_id,farmer_owner_id)
select s.id,f.id from review_test_ids s,review_test_ids f where s.label='admin' and f.label='farmer';
set local role authenticated;
do $$ declare p public.farmers; denied boolean=false; before_review timestamptz; begin
  select * into p from public.farmers where id=(select id from review_test_ids where label='profile'); before_review=p.updated_at;
  begin update public.farmers set registration_status='approved' where id=p.id; exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: direct approval bypass'; end if;
  denied=false;
  begin perform public.review_farmer_profile(p.id,p.updated_at,'rejected','short'); exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: short correction reason'; end if;
  perform public.review_farmer_profile(p.id,p.updated_at,'rejected','Please correct your barangay address.');
  if not exists(select 1 from public.farmer_profile_reviews where farmer_id=p.id and decision='rejected' and note='Please correct your barangay address.') then raise exception 'FAIL: missing correction history'; end if;
  denied=false;
  begin perform public.review_farmer_profile(p.id,before_review,'approved','Reviewed and approved.'); exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: stale decision accepted'; end if;
end $$;
reset role;

-- Owner reads feedback, cannot forge it, and resubmits with a new revision.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from review_test_ids where label='farmer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p public.farmers; denied boolean=false; begin
  select * into p from public.farmers where owner_id=auth.uid();
  if not exists(select 1 from public.farmer_profile_reviews where decision='rejected') then raise exception 'FAIL: owner cannot read feedback'; end if;
  begin perform public.review_farmer_profile(p.id,p.updated_at,'approved','Reviewed and approved.'); exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: self approval'; end if;
  denied=false;
  begin insert into public.farmer_profile_reviews(farmer_id,owner_id,decision,note) values(p.id,auth.uid(),'approved','Forged approval note.'); exception when insufficient_privilege then denied=true; end;
  if not denied then raise exception 'FAIL: history forgery'; end if;
  perform public.resubmit_farmer_profile(p.id,p.updated_at);
  if (select registration_status from public.farmers where id=p.id)<>'pending' then raise exception 'FAIL: resubmission state'; end if;
  if not exists(select 1 from public.farmer_profile_reviews where decision='resubmitted') then raise exception 'FAIL: resubmission history'; end if;
end $$;
reset role;

-- Assigned field personnel may view submissions but never approve.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from review_test_ids where label='field'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p public.farmers; denied boolean=false; begin
  select * into p from public.farmers where id=(select id from review_test_ids where label='profile');
  if p.id is null then raise exception 'FAIL: assigned field read'; end if;
  begin perform public.review_farmer_profile(p.id,p.updated_at,'approved','Reviewed and approved.'); exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: field approval'; end if;
end $$;
reset role;

-- Assigned approval succeeds; subsequent profile edits return it to review.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from review_test_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare p public.farmers; begin
  select * into p from public.farmers where id=(select id from review_test_ids where label='profile');
  perform public.review_farmer_profile(p.id,p.updated_at,'approved','Profile details have been checked.');
  if (select registration_status from public.farmers where id=p.id)<>'approved' then raise exception 'FAIL: approval state'; end if;
  update public.farmers set address='Corrected address' where id=p.id;
  if (select registration_status from public.farmers where id=p.id)<>'pending' then raise exception 'FAIL: substantive edit did not reopen review'; end if;
end $$;
reset role;

select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from review_test_ids where label='other'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin if exists(select 1 from public.farmer_profile_reviews) then raise exception 'FAIL: another owner can read review history'; end if; end $$;
reset role;
rollback;
