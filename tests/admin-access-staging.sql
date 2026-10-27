-- STAGING ONLY after 001-014. Fixtures and decisions roll back.
begin;
create temp table admin_access_ids(label text primary key,id uuid default gen_random_uuid());
insert into admin_access_ids(label) values('farmer_a'),('farmer_b'),('admin'),('field');
grant select on admin_access_ids to authenticated;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'admin-access-'||id||'@example.invalid','authenticated','authenticated','{}','{}',now(),now() from admin_access_ids;
update public.profiles p set role=i.label from admin_access_ids i where p.id=i.id and i.label in ('admin','field');
insert into public.farmers(owner_id,full_name,first_name,last_name,barangay,consent_at)
select id,'Access Test Farmer','Access','Farmer','Test',now() from admin_access_ids where label='farmer_a';
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from admin_access_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare r public.farmers; denied boolean=false; begin
 if not private.can_access((select id from admin_access_ids where label='farmer_a')) or not private.can_access((select id from admin_access_ids where label='farmer_b')) then raise exception 'FAIL: admin still needs assignments';end if;
 if not exists(select 1 from public.profiles where id=(select id from admin_access_ids where label='farmer_b')) then raise exception 'FAIL: farmer picker omits account without records';end if;
 select * into r from public.farmers where owner_id=(select id from admin_access_ids where label='farmer_a');
 if r.id is null then raise exception 'FAIL: admin cannot read farmer';end if;
 perform public.review_farmer_profile(r.id,r.updated_at,'approved','Administrator reviewed without an assignment.');
 begin perform public.set_account_access((select id from admin_access_ids where label='field'),'admin','active');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: admin can change account roles';end if;
 denied=false;
 begin insert into public.staff_farmer_assignments(staff_id,farmer_owner_id) select a.id,b.id from admin_access_ids a,admin_access_ids b where a.label='field' and b.label='farmer_b';exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL: admin can manage assignments';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from admin_access_ids where label='field'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if private.can_access((select id from admin_access_ids where label='farmer_a')) then raise exception 'FAIL: unassigned field access';end if;
 if exists(select 1 from public.farmers where owner_id=(select id from admin_access_ids where label='farmer_a')) then raise exception 'FAIL: unassigned field sees farmer';end if;
end $$;
reset role;
insert into public.staff_farmer_assignments(staff_id,farmer_owner_id)
select a.id,b.id from admin_access_ids a,admin_access_ids b where a.label='field' and b.label='farmer_a';
set local role authenticated;
do $$ begin
 if not private.can_access((select id from admin_access_ids where label='farmer_a')) or private.can_access((select id from admin_access_ids where label='farmer_b')) then raise exception 'FAIL: field assignment scope';end if;
end $$;
reset role;
update public.profiles set account_status='suspended' where id=(select id from admin_access_ids where label='admin');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from admin_access_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if private.can_access((select id from admin_access_ids where label='farmer_a')) then raise exception 'FAIL: suspended admin access';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from admin_access_ids where label='farmer_b'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
 if private.can_access((select id from admin_access_ids where label='farmer_a')) then raise exception 'FAIL: farmer isolation';end if;
end $$;
reset role;
rollback;
