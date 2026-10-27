-- STAGING ONLY, after 001-011. Execute as postgres; fixtures and changes roll back.
begin;
create temp table process_ids(label text primary key,id uuid default gen_random_uuid());
insert into process_ids(label) values('owner'),('other'),('reviewer'),('farm'),('harvest'),('batch'),('observation');
grant select on process_ids to authenticated;
insert into auth.users(id,email,aud,role,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select id,'process-test-'||id||'@example.invalid','authenticated','authenticated','{}','{}',now(),now() from process_ids where label in ('owner','other','reviewer');
update public.profiles set role='field' where id=(select id from process_ids where label='reviewer');
insert into public.staff_farmer_assignments(staff_id,farmer_owner_id) select s.id,o.id from process_ids s,process_ids o where s.label='reviewer' and o.label='owner';
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from process_ids where label='owner'),'role','authenticated')::text,true);
insert into public.plantations(id,owner_id,name,farmer_name,barangay,municipality,province,boundary,area_sqm)
select f.id,o.id,'Process test farm','Sample farmer','Test','Sample municipality','Zamboanga del Norte',
 '{"type":"Polygon","coordinates":[[[123.300,8.500],[123.301,8.500],[123.301,8.501],[123.300,8.501],[123.300,8.500]]]}'::jsonb,1 from process_ids f,process_ids o where f.label='farm' and o.label='owner';
insert into public.harvests(id,owner_id,plantation_id,harvest_date,wet_bean_kg,dry_bean_kg)
select h.id,o.id,f.id,(now() at time zone 'Asia/Manila')::date-7,100,0 from process_ids h,process_ids o,process_ids f where h.label='harvest' and o.label='owner' and f.label='farm';
set local role authenticated;
do $$ declare b public.harvest_batches;p jsonb;day date=(now() at time zone 'Asia/Manila')::date;denied boolean=false;begin
 b=public.save_harvest_batch((select id from process_ids where label='batch'),jsonb_build_object('action','create','harvest_id',(select id from process_ids where label='harvest'),'code','PROCESS-TEST','event_on',day-7,'weight_kg',80,'note','Test allocation'));
 p=jsonb_build_object('action','advance','batch_id',b.id,'expected_revision',b.revision,'stage','fermenting','event_on',day-7,'weight_kg',80,'note','Start fermentation');b=public.save_harvest_batch(gen_random_uuid(),p);
 p=p||jsonb_build_object('expected_revision',b.revision,'stage','drying','event_on',day-2,'weight_kg',30);b=public.save_harvest_batch(gen_random_uuid(),p);
 p=p||jsonb_build_object('expected_revision',b.revision,'stage','quality_check','event_on',day,'quality_result','pass','moisture_pct',7);b=public.save_harvest_batch(gen_random_uuid(),p);
 begin perform public.save_harvest_batch(gen_random_uuid(),(p-'quality_result'-'moisture_pct')||jsonb_build_object('expected_revision',b.revision,'stage','stored'));exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: storage without protocol and assessment';end if;
 p=jsonb_build_object('batch_id',b.id,'kind','quality','observed_at',clock_timestamp()-interval '1 hour','detail',jsonb_build_object('moisture_pct',7,'sample_beans',100,'moldy',0,'slaty',1,'insect_damaged',1,'grade','premium','assessor','Owner observation'),'note','Initial observation');
 denied=false;begin perform public.record_postharvest(gen_random_uuid(),p);exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: farmer final grade';end if;
 p=jsonb_set(p,'{detail,grade}','"ungraded"');perform public.record_postharvest((select id from process_ids where label='observation'),p);perform public.record_postharvest((select id from process_ids where label='observation'),p);
 if (select count(*) from public.postharvest_records)<>1 then raise exception 'FAIL: observation retry duplicated record';end if;
 denied=false;begin update public.postharvest_records set note='Overwrite';exception when insufficient_privilege then denied=true;end;
 if not denied then raise exception 'FAIL: direct record overwrite';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from process_ids where label='reviewer'),'role','authenticated')::text,true);
set local role authenticated;
do $$ declare b public.harvest_batches;p jsonb;q public.postharvest_records;cost public.postharvest_records;day date=(now() at time zone 'Asia/Manila')::date;denied boolean=false;begin
 select * into b from public.harvest_batches where id=(select id from process_ids where label='batch');
 perform public.record_postharvest(gen_random_uuid(),jsonb_build_object('batch_id',b.id,'kind','protocol','observed_at',clock_timestamp()-interval '2 hours','detail',jsonb_build_object('facility','Test facility','reference','Test buyer protocol','started_at',clock_timestamp()-interval '7 days','min_hours',120,'turn_hours',24,'max_moisture',8,'max_defects',5),'note','Agreed test reference'));
 p=jsonb_build_object('batch_id',b.id,'kind','quality','observed_at',clock_timestamp()-interval '1 hour','detail',jsonb_build_object('moisture_pct',12,'sample_beans',100,'moldy',0,'slaty',1,'insect_damaged',1,'grade','standard','assessor','Assigned test reviewer'),'note','Quality assessment','supersedes_id',(select id from process_ids where label='observation'));
 q=public.record_postharvest(gen_random_uuid(),p);
 begin perform public.save_harvest_batch(gen_random_uuid(),jsonb_build_object('action','advance','batch_id',b.id,'expected_revision',b.revision,'stage','stored','event_on',day,'weight_kg',30,'note','Attempt above moisture target'));exception when raise_exception then denied=true;end;
 if not denied then raise exception 'FAIL: above-target moisture entered storage';end if;
 p=jsonb_set(p,'{detail,moisture_pct}','7')||jsonb_build_object('supersedes_id',q.id,'note','Corrected test measurement');q=public.record_postharvest(gen_random_uuid(),p);
 b=public.save_harvest_batch(gen_random_uuid(),jsonb_build_object('action','advance','batch_id',b.id,'expected_revision',b.revision,'stage','stored','event_on',day,'weight_kg',30,'note','Checks meet agreed targets'));
 if b.stage<>'stored' then raise exception 'FAIL: compliant storage';end if;
 cost=public.record_postharvest(gen_random_uuid(),jsonb_build_object('batch_id',b.id,'kind','cost','observed_at',clock_timestamp(),'detail',jsonb_build_object('category','labor','amount_php',100),'note','Test cost receipt'));
 perform public.record_postharvest(gen_random_uuid(),jsonb_build_object('batch_id',b.id,'kind','cost','observed_at',clock_timestamp(),'detail',jsonb_build_object('category','labor','amount_php',40),'note','Correction retained in history','supersedes_id',cost.id));
 if (select count(*) from public.postharvest_records where kind='cost')<>2 then raise exception 'FAIL: original cost not retained';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select id from process_ids where label='other'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin if exists(select 1 from public.postharvest_records) then raise exception 'FAIL: unrelated farmer sees process records';end if;end $$;
reset role;
rollback;
