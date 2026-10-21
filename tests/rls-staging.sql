-- Run ONLY against a staging Supabase database after migrations 001-007.
-- All fixtures and changes roll back. This is not a production migration.
begin;
create temp table cacao_test_ids(label text primary key,id uuid default gen_random_uuid());
insert into cacao_test_ids(label) values('farmer_a'),('farmer_b'),('admin'),('super');
grant select on cacao_test_ids to authenticated;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'cacao-test-'||id||'@example.invalid','authenticated','authenticated','{}','{}',now(),now() from cacao_test_ids;
update public.profiles set role='admin' where id=(select id from cacao_test_ids where label='admin');
update public.profiles set role='super_admin' where id=(select id from cacao_test_ids where label='super');
insert into public.farmers(owner_id,full_name,first_name,last_name,barangay,consent_at)
select id,'Test Farmer A','Test','Farmer A','Test Barangay',now() from cacao_test_ids where label='farmer_a';
insert into public.farmers(owner_id,full_name,first_name,last_name,barangay,consent_at)
select id,'Test Farmer B','Test','Farmer B','Other Barangay',now() from cacao_test_ids where label='farmer_b';
insert into public.plantations(owner_id,farmer_id,name,farmer_name,barangay,municipality,province,boundary,area_sqm)
select owner_id,id,'Test cacao farm','Test Farmer A','Test Barangay','Isabela City','Basilan',
  '{"type":"Polygon","coordinates":[[[121.970,6.700],[121.971,6.700],[121.971,6.701],[121.970,6.701],[121.970,6.700]]]}'::jsonb,1
from public.farmers where owner_id=(select id from cacao_test_ids where label='farmer_a');

-- A forged JWT role must not grant permissions: DB profiles are authoritative.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from cacao_test_ids where label='farmer_a'),'role','authenticated','app_metadata',jsonb_build_object('role','super_admin'))::text,true);
set local role authenticated;
do $$ declare denied boolean=false; area double precision; begin
  if (select count(*) from public.farmers)<>1 then raise exception 'FAIL: farmer isolation'; end if;
  if private.user_role()<>'farmer' then raise exception 'FAIL: forged role escalation'; end if;
  select area_sqm into area from public.plantations where name='Test cacao farm';
  if area<=1000 or area=1 then raise exception 'FAIL: server area computation'; end if;
  begin update public.profiles set role='super_admin' where id=auth.uid(); exception when insufficient_privilege then denied=true; end;
  if not denied then raise exception 'FAIL: editable profile role'; end if;
  denied=false;
  begin update public.farmers set registration_status='approved' where owner_id=auth.uid(); exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: farmer self approval'; end if;
  denied=false;
  begin insert into public.activity_logs(owner_id,action) values(auth.uid(),'forged'); exception when insufficient_privilege then denied=true; end;
  if not denied then raise exception 'FAIL: forged audit history'; end if;
  denied=false;
  begin update public.plantations set boundary='{"type":"Polygon","coordinates":[[[121.970,6.700],[121.971,6.701],[121.970,6.701],[121.971,6.700],[121.970,6.700]]]}'::jsonb; exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: self-intersecting polygon accepted'; end if;
  insert into public.cacao_tree_inventories(owner_id,plantation_id,mature,productive,non_productive)
  select owner_id,id,20,15,5 from public.plantations where name='Test cacao farm';
  if (select tree_count from public.plantations where name='Test cacao farm')<>20 then raise exception 'FAIL: inventory does not update plantation total'; end if;
  denied=false;
  begin update public.cacao_tree_inventories set mature=100; exception when insufficient_privilege then denied=true; end;
  if not denied then raise exception 'FAIL: inventory history editable'; end if;
end $$;
reset role;

-- Unassigned admin sees no farmer records; assignment grants only the assigned account.
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from cacao_test_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin if exists(select 1 from public.farmers) then raise exception 'FAIL: unassigned admin bypass'; end if; end $$;
reset role;
insert into public.staff_farmer_assignments(staff_id,farmer_owner_id)
select a.id,b.id from cacao_test_ids a,cacao_test_ids b where a.label='admin' and b.label='farmer_a';
set local role authenticated;
do $$ begin
  if (select count(*) from public.farmers)<>1 then raise exception 'FAIL: assigned admin scope'; end if;
  update public.farmers set registration_status='approved';
  if not exists(select 1 from public.farmers where registration_status='approved') then raise exception 'FAIL: assigned approval'; end if;
end $$;
reset role;
update public.profiles set account_status='suspended' where id=(select id from cacao_test_ids where label='admin');
set local role authenticated;
do $$ begin if exists(select 1 from public.farmers) then raise exception 'FAIL: suspended account access'; end if; end $$;
reset role;

-- Enhancement assertions: real PostGIS touching/overlap behavior and transactional retry receipts.
update public.profiles set account_status='active' where id=(select id from cacao_test_ids where label='admin');
insert into cacao_test_ids(label) values('neighbor_farm'),('sync_change'),('harvest_record');
insert into public.plantations(id,owner_id,name,farmer_name,barangay,municipality,province,boundary)
select n.id,b.id,'Touching parcel','Test Farmer B','Other Barangay','Isabela City','Basilan',
  '{"type":"Polygon","coordinates":[[[121.971,6.700],[121.972,6.700],[121.972,6.701],[121.971,6.701],[121.971,6.700]]]}'::jsonb
from cacao_test_ids n,cacao_test_ids b where n.label='neighbor_farm' and b.label='farmer_b';
do $ begin
  if exists(select 1 from public.plantation_overlap_flags where plantation_id=(select id from cacao_test_ids where label='neighbor_farm') and other_plantation_id=(select id from public.plantations where owner_id=(select id from cacao_test_ids where label='farmer_a') and name='Test cacao farm')) then raise exception 'FAIL: shared boundary flagged as overlap'; end if;
end $;
update public.plantations set boundary='{"type":"Polygon","coordinates":[[[121.9705,6.700],[121.9715,6.700],[121.9715,6.701],[121.9705,6.701],[121.9705,6.700]]]}'::jsonb
where id=(select id from cacao_test_ids where label='neighbor_farm');
do $ begin
  if not exists(select 1 from public.plantation_overlap_flags where plantation_id=(select id from cacao_test_ids where label='neighbor_farm') and other_plantation_id=(select id from public.plantations where owner_id=(select id from cacao_test_ids where label='farmer_a') and name='Test cacao farm') and overlap_sqm>0.01) then raise exception 'FAIL: real overlap not detected'; end if;
end $;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from cacao_test_ids where label='farmer_a'),'role','authenticated')::text,true);
set local role authenticated;
do $ declare first_result jsonb;second_result jsonb;payload jsonb;change_key uuid;record_key uuid;denied boolean=false; begin
  select id into change_key from cacao_test_ids where label='sync_change';select id into record_key from cacao_test_ids where label='harvest_record';
  select jsonb_build_object('owner_id',owner_id,'plantation_id',id,'harvest_date',current_date-1,'wet_bean_kg',100,'dry_bean_kg',30,'estimated_value_php',4500) into payload from public.plantations where name='Test cacao farm';
  first_result=public.apply_field_change(change_key,'harvests',record_key,'create',payload);
  second_result=public.apply_field_change(change_key,'harvests',record_key,'create',payload);
  if first_result->>'confirmed'<>'true' or second_result->>'replayed'<>'true' or (select count(*) from public.harvests where id=record_key)<>1 then raise exception 'FAIL: idempotent harvest receipt'; end if;
  if (first_result->'record'->>'area_sqm_at_harvest')::double precision<=0 then raise exception 'FAIL: missing harvest area snapshot'; end if;
  begin perform public.apply_field_change(change_key,'harvests',record_key,'create',payload||'{"wet_bean_kg":200}'); exception when unique_violation then denied=true; end;
  if not denied then raise exception 'FAIL: altered request accepted under same receipt key'; end if;
  denied=false;
  begin perform public.apply_field_change(gen_random_uuid(),'harvests',gen_random_uuid(),'create',payload||jsonb_build_object('owner_id',(select id from cacao_test_ids where label='farmer_b'))); exception when insufficient_privilege then denied=true; end;
  if not denied then raise exception 'FAIL: sync bypassed owner scope'; end if;
  denied=false;
  begin update public.gps_tracking_points set accuracy=1; exception when insufficient_privilege then denied=true; end;
  if not denied then raise exception 'FAIL: original GPS points can be modified'; end if;
  denied=false;
  begin insert into public.farmers(owner_id,full_name,first_name,last_name,barangay,contact_number) values(auth.uid(),'Test Farmer A','Test','Farmer A','Test Barangay','123456');
    insert into public.farmers(owner_id,full_name,first_name,last_name,barangay,contact_number) values(auth.uid(),'Test Farmer A','Test','Farmer A','Test Barangay','123456');
  exception when unique_violation then denied=true; end;
  if not denied then raise exception 'FAIL: duplicate farmer identity accepted'; end if;
end $;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from cacao_test_ids where label='admin'),'role','authenticated')::text,true);
set local role authenticated;
do $ declare denied boolean=false;farm public.plantations; begin
  select * into farm from public.plantations where name='Test cacao farm';
  begin update public.plantations set verification_status='verified' where id=farm.id; exception when raise_exception then denied=true; end;
  if not denied then raise exception 'FAIL: mapping review note bypass'; end if;
  perform public.review_plantation(farm.id,farm.revision,'verified','Staging review: potential overlap inspected and recorded for follow-up.');
  if not exists(select 1 from public.mapping_reviews where plantation_id=farm.id) then raise exception 'FAIL: mapping review history missing'; end if;
end $;
reset role;

rollback;
-- Success: every assertion completed, fixtures rolled back.
