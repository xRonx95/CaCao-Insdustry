-- STAGING ONLY after 001-013. All fixtures and changes roll back.
begin;
create temp table staff_review_ids(label text primary key,id uuid default gen_random_uuid());
insert into staff_review_ids(label) values('field'),('other_field'),('farmer'),('admin');
grant select on staff_review_ids to authenticated;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'staff-review-'||id||'@example.invalid','authenticated','authenticated','{}','{}',now(),now() from staff_review_ids;
update public.profiles p set role=case when i.label in ('field','other_field') then 'field' when i.label='admin' then 'admin' else 'farmer' end
from staff_review_ids i where p.id=i.id;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from staff_review_ids where label='field'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r public.field_profiles; denied boolean=false; begin
 r=public.save_field_profile(null,'{"full_name":"Test Field Officer","phone":"09123456789","address":"Test address","position":"Field officer"}'::jsonb);
 if r.registration_status<>'pending' then raise exception 'FAIL: new submission not pending';end if;
 begin perform public.review_field_profile(r.id,r.updated_at,'approved','Attempted self approval.');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: self approval';end if;
 denied=false;
 begin update public.field_profiles set registration_status='approved' where id=r.id;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL: direct status write';end if;
 denied=false;
 begin insert into public.field_profile_reviews(profile_id,actor_id,decision,note) values(r.id,auth.uid(),'approved','Attempted forged approval.');exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL: forged history';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from staff_review_ids where label='other_field'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if exists(select 1 from public.field_profiles where id=(select id from staff_review_ids where label='field')) then raise exception 'FAIL: unrelated staff profile visible';end if;
 if exists(select 1 from public.field_profile_reviews where profile_id=(select id from staff_review_ids where label='field')) then raise exception 'FAIL: unrelated review history visible';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from staff_review_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r public.field_profiles; original timestamptz; denied boolean=false; begin
 select * into r from public.field_profiles where id=(select id from staff_review_ids where label='field');
 if r.id is null then raise exception 'FAIL: administrator cannot see staff submission';end if;
 original=r.updated_at;
 begin perform public.review_field_profile(r.id,r.updated_at,'approved','short');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: short approval feedback accepted';end if;
 r=public.review_field_profile(r.id,r.updated_at,'approved','Staff details verified by administrator.');
 if r.registration_status<>'approved' then raise exception 'FAIL: administrator approval';end if;
 denied=false;
 begin perform public.review_field_profile(r.id,original,'rejected','Stale correction request rejected.');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: stale review accepted';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from staff_review_ids where label='field'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r public.field_profiles; begin
 select * into r from public.field_profiles where id=auth.uid();
 if r.registration_status<>'approved' or not exists(select 1 from public.field_profile_reviews where profile_id=r.id and decision='approved') then raise exception 'FAIL: field cannot see approval';end if;
 r=public.save_field_profile(r.updated_at,'{"full_name":"Test Field Officer","phone":"09123456789","address":"Updated address","position":"Field officer"}'::jsonb);
 if r.registration_status<>'pending' then raise exception 'FAIL: edits did not reopen review';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from staff_review_ids where label='farmer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare denied boolean=false; begin
 if exists(select 1 from public.field_profiles where id=(select id from staff_review_ids where label='field')) then raise exception 'FAIL: farmer reads staff profile';end if;
 begin perform public.save_field_profile(null,'{"full_name":"Unauthorized"}'::jsonb);exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: farmer submitted staff profile';end if;
end $$;
reset role;
rollback;
