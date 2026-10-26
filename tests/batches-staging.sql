-- STAGING ONLY. Apply 001-010 first. Run as postgres; all fixtures roll back.
begin;
create temp table batch_test_ids(label text primary key,id uuid default gen_random_uuid());
insert into batch_test_ids(label) values('owner'),('other'),('staff'),('farm'),('harvest'),('batch');
grant select on batch_test_ids to authenticated;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'batch-test-'||id||'@example.invalid','authenticated','authenticated','{}','{}',now(),now() from batch_test_ids where label in ('owner','other','staff');
update public.profiles set role='admin' where id=(select id from batch_test_ids where label='staff');
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from batch_test_ids where label='owner'),'role','authenticated')::text,true);
insert into public.plantations(id,owner_id,name,farmer_name,barangay,municipality,province,boundary,area_sqm)
select f.id,o.id,'Batch test farm','Sample farmer','Test','Isabela City','Basilan',
 '{"type":"Polygon","coordinates":[[[121.970,6.700],[121.971,6.700],[121.971,6.701],[121.970,6.701],[121.970,6.700]]]}'::jsonb,1
from batch_test_ids f,batch_test_ids o where f.label='farm' and o.label='owner';
insert into public.harvests(id,owner_id,plantation_id,harvest_date,wet_bean_kg,dry_bean_kg)
select h.id,o.id,f.id,(now() at time zone 'Asia/Manila')::date-1,100,0 from batch_test_ids h,batch_test_ids o,batch_test_ids f where h.label='harvest' and o.label='owner' and f.label='farm';
set local role authenticated;
do $$ declare b public.harvest_batches; payload jsonb; day date=(now() at time zone 'Asia/Manila')::date; denied boolean; begin
 payload=jsonb_build_object('action','create','harvest_id',(select id from batch_test_ids where label='harvest'),'code','TEST-LOT-1','event_on',day,'weight_kg',80,'note','Test allocation');
 b=public.save_harvest_batch((select id from batch_test_ids where label='batch'),payload);
 perform public.save_harvest_batch(b.id,payload);
 if (select count(*) from public.harvest_batch_events where batch_id=b.id)<>1 then raise exception 'FAIL: replay duplicated history'; end if;
 denied=false;begin perform public.save_harvest_batch(b.id,payload||'{"note":"Changed command"}');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: reused receipt accepted another command';end if;
 denied=false;begin perform public.save_harvest_batch(gen_random_uuid(),payload||'{"code":"TEST-LOT-2","weight_kg":25}');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: overallocated harvest';end if;
 denied=false;begin update public.harvests set wet_bean_kg=79 where id=b.harvest_id;exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: harvest allocation invalidated by edit';end if;
 denied=false;begin update public.harvest_batches set stage='sold' where id=b.id;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL: direct state write';end if;
 payload=jsonb_build_object('action','advance','batch_id',b.id,'expected_revision',b.revision,'stage','stored','event_on',day,'weight_kg',80,'note','Invalid skipped stage');
 denied=false;begin perform public.save_harvest_batch(gen_random_uuid(),payload);exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: skipped stages';end if;
 payload=payload||'{"stage":"fermenting"}';b=public.save_harvest_batch(gen_random_uuid(),payload);
 denied=false;begin perform public.save_harvest_batch(gen_random_uuid(),payload);exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: stale revision';end if;
 payload=payload||jsonb_build_object('expected_revision',b.revision,'stage','drying','weight_kg',30);b=public.save_harvest_batch(gen_random_uuid(),payload);
 payload=payload||jsonb_build_object('expected_revision',b.revision,'stage','quality_check','quality_result','hold','moisture_pct',12);b=public.save_harvest_batch(gen_random_uuid(),payload);
 denied=false;begin perform public.save_harvest_batch(gen_random_uuid(),(payload-'quality_result'-'moisture_pct')||jsonb_build_object('expected_revision',b.revision,'stage','stored'));exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: held batch entered storage';end if;
 payload=payload||jsonb_build_object('expected_revision',b.revision,'quality_result','pass','moisture_pct',7);b=public.save_harvest_batch(gen_random_uuid(),payload);
 payload=(payload-'quality_result'-'moisture_pct')||jsonb_build_object('expected_revision',b.revision,'stage','stored');b=public.save_harvest_batch(gen_random_uuid(),payload);
 payload=payload||jsonb_build_object('expected_revision',b.revision,'stage','sold','buyer','Test Buyer','sale_php',1000);
 denied=false;begin perform public.save_harvest_batch(gen_random_uuid(),payload||'{"weight_kg":15}');exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: partial sale';end if;
 b=public.save_harvest_batch(gen_random_uuid(),payload);
 if b.stage<>'sold' or b.revision<>7 or (select count(*) from public.harvest_batch_events where batch_id=b.id)<>7 then raise exception 'FAIL: complete batch timeline';end if;
 denied=false;begin delete from public.harvest_batch_events where batch_id=b.id;exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL: history deletion';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from batch_test_ids where label='other'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare denied boolean=false;begin
 if exists(select 1 from public.harvest_batches) or exists(select 1 from public.harvest_batch_events) then raise exception 'FAIL: another farmer sees private batches';end if;
 begin perform public.save_harvest_batch(gen_random_uuid(),jsonb_build_object('action','create','harvest_id',(select id from batch_test_ids where label='harvest'),'code','FORGED','event_on',(now() at time zone 'Asia/Manila')::date,'weight_kg',1,'note','Unauthorized command'));exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: foreign harvest allocation';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from batch_test_ids where label='staff'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin if exists(select 1 from public.harvest_batches) then raise exception 'FAIL: unassigned staff sees batches';end if;end $$;
reset role;
insert into public.staff_farmer_assignments(staff_id,farmer_owner_id) select s.id,o.id from batch_test_ids s,batch_test_ids o where s.label='staff' and o.label='owner';
set local role authenticated;
do $$ begin if (select count(*) from public.harvest_batches)<>1 or (select count(*) from public.harvest_batch_events)<>7 then raise exception 'FAIL: assigned staff access';end if;end $$;
reset role;
rollback;
