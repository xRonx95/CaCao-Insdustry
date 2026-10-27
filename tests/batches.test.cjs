const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/js/batches.js','utf8');
const context=vm.createContext({window:{}});vm.runInContext(source.slice(0,source.lastIndexOf('CacaoBatches.start();')),context);
const api=context.window.CacaoBatches;
const command=(stage='fermenting')=>({action:'advance',event_on:'2026-10-01',weight_kg:'10',note:'Recorded observation',stage});
test('batch stages cannot skip drying or bypass a held quality result',()=>{
 assert.deepEqual([...api.next({stage:'harvested'})],['fermenting']);
 assert.deepEqual([...api.next({stage:'quality_check',quality_result:'hold'})],['quality_check']);
 assert.deepEqual([...api.next({stage:'quality_check',quality_result:'pass'})],['quality_check','stored']);
 assert.deepEqual([...api.next({stage:'sold'})],[]);
 assert.throws(()=>api.validate(command('stored'),{stage:'fermenting',stage_on:'2026-09-30',current_weight_kg:10},null,'2026-10-27'),/next permitted/);
});
test('batch weights, event dates and wet harvest allocations are validated',()=>{
 const batch={stage:'harvested',stage_on:'2026-10-02',current_weight_kg:9};
 assert.throws(()=>api.validate(command(),batch,null,'2026-10-27'),/precede/);
 assert.throws(()=>api.validate({...command(),event_on:'2026-10-03'},batch,null,'2026-10-27'),/increase/);
 assert.throws(()=>api.validate({...command(),weight_kg:'NaN'},batch,null,'2026-10-27'),/positive weight/);
 assert.throws(()=>api.validate({...command(),event_on:'2027-01-01'},batch,null,'2026-10-27'),/future/);
 assert.throws(()=>api.validate({...command(),action:'create',code:'LOT-1'},null,{wet_bean_kg:5,harvest_date:'2026-09-01'},'2026-10-27'),/exceeds/);
});
test('quality requires measured moisture; sales require the full stored batch',()=>{
 const quality={stage:'drying',stage_on:'2026-09-30',current_weight_kg:10};
 assert.throws(()=>api.validate({...command('quality_check'),quality_result:'pass',moisture_pct:''},quality,null,'2026-10-27'),/moisture/);
 assert.throws(()=>api.validate({...command('quality_check'),quality_result:'pass',moisture_pct:'101'},quality,null,'2026-10-27'),/moisture/);
 const stored={...quality,stage:'stored'};
 assert.throws(()=>api.validate({...command('sold'),buyer:'',sale_php:'100'},stored,null,'2026-10-27'),/buyer/);
 assert.throws(()=>api.validate({...command('sold'),buyer:'Buyer',sale_php:'100',weight_kg:'5'},stored,null,'2026-10-27'),/whole stored/);
 assert.equal(api.validate({...command('sold'),buyer:'Buyer',sale_php:'100'},stored,null,'2026-10-27').stage,'sold');
});
test('migration keeps batch writes behind a scoped, locked, retry-safe command',()=>{
 const sql=fs.readFileSync('sql/010_harvest_batches.sql','utf8');
 assert.match(sql,/private\.can_access\(h.owner_id\)/);assert.match(sql,/private\.can_access\(b.owner_id\)/);
 assert.match(sql,/pg_advisory_xact_lock/);assert.match(sql,/e.request is distinct from p_payload/);
 assert.match(sql,/expected_revision/);assert.match(sql,/for update/g);assert.match(sql,/v_total\+v_weight>h.wet_bean_kg/);
 assert.match(sql,/grant select on public.harvest_batches,public.harvest_batch_events/);
 assert.doesNotMatch(sql,/grant (?:insert|update|delete)/i);
 assert.match(sql,/new.wet_bean_kg<allocated/);assert.match(sql,/batch_id,revision/);
});

test('farmers and field staff cannot approve quality, storage or sales',()=>{for(const role of ['farmer','field','unknown'])for(const batch of [{stage:'drying'},{stage:'quality_check',quality_result:'pass'},{stage:'stored'}])assert.deepEqual([...api.permitted(batch,role)],[]);for(const role of ['admin','super_admin'])assert.deepEqual([...api.permitted({stage:'stored'},role)],['sold']);assert.deepEqual([...api.permitted({stage:'harvested'},'farmer')],['fermenting']);});
