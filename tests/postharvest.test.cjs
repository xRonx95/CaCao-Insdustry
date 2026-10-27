const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('assets/js/postharvest.js','utf8'),context=vm.createContext({window:{}});vm.runInContext(source.slice(0,source.lastIndexOf('CacaoPostharvest.start();')),context);const api=context.window.CacaoPostharvest;
const record=(id,kind,detail,extra={})=>({id,batch_id:'batch',kind,detail,observed_at:'2026-01-01T12:00:00Z',created_at:'2026-01-01T12:00:00Z',weight_snapshot_kg:10,...extra});
test('corrected costs count once while the original remains in history',()=>{
 const rows=[record('a','cost',{amount_php:100}),record('b','cost',{amount_php:40},{supersedes_id:'a'})];const m=api.metrics([{id:'batch',stage:'sold',sale_php:200}],rows);assert.equal(m.costs,40);assert.equal(m.margin,160);assert.equal(api.effective(rows).length,1);assert.equal(rows.length,2);
});
test('no quality assessments do not become a zero-percent downgrade claim',()=>{
 assert.equal(api.metrics([{id:'batch',stage:'harvested'}],[]).downgradePct,null);
 const m=api.metrics([{id:'batch',stage:'stored'}],[record('q','quality',{grade:'downgraded'})]);assert.equal(m.downgradePct,100);assert.equal(m.gradedCount,1);
});
test('farmer observations cannot assign final grades or protocols',()=>{
 const detail={moisture_pct:7,sample_beans:100,moldy:0,slaty:1,insect_damaged:0,grade:'premium',assessor:'Reviewer'};
 assert.throws(()=>api.validate('quality',detail,'farmer'),/Only administrators/);assert.throws(()=>api.validate('quality',{...detail,grade:'ungraded'},'farmer'),/Only administrators/);
 assert.throws(()=>api.validate('quality',{...detail,moldy:100},'admin'),/sample size/);assert.throws(()=>api.validate('protocol',{},'farmer'),/Only administrators/);
});
test('turning reminders and moisture exceptions use the agreed protocol',()=>{
 const rows=[record('p','protocol',{started_at:'2026-01-01T00:00:00Z',min_hours:48,turn_hours:12,max_moisture:8,max_defects:5}),record('d','drying',{moisture_pct:12})];const result=api.checks({id:'batch',stage:'fermenting'},rows,Date.parse('2026-01-02T00:00:00Z'));assert(result.some(text=>text.includes('Turning check is due')));assert(result.some(text=>text.includes('exceeds')));
});
test('a corrected false turning observation does not postpone the reminder',()=>{
 const rows=[record('p','protocol',{started_at:'2026-01-01T00:00:00Z',min_hours:48,turn_hours:24,max_moisture:8,max_defects:5}),record('turn','fermentation',{turned:true},{observed_at:'2026-01-02T12:00:00Z'}),record('correction','fermentation',{turned:false},{supersedes_id:'turn',observed_at:'2026-01-02T12:00:00Z'})];assert(api.checks({id:'batch',stage:'fermenting'},rows,Date.parse('2026-01-02T13:00:00Z')).some(text=>text.includes('Turning check is due')));
});
test('SQL guards scope, corrections, final grades and storage evidence',()=>{
 const sql=fs.readFileSync('sql/011_postharvest_learning.sql','utf8');assert.match(sql,/private\.can_access\(b.owner_id\)/);assert.match(sql,/supersedes_id uuid unique/);assert.match(sql,/Assigned staff must record the final grade/);assert.match(sql,/guard_postharvest_storage/);assert.match(sql,/minimum fermentation time/);assert.match(sql,/new.moisture_pct>/);assert.doesNotMatch(sql,/grant (insert|update|delete)/i);
});

test('only administrators can enter reviewed and commercial process records',()=>{for(const role of ['farmer','field','admin','super_admin','unknown'])for(const kind of Object.keys(api.kinds)){assert.equal(api.canRecord(kind,role),['admin','super_admin'].includes(role)||(['farmer','field'].includes(role)&&['fermentation','drying'].includes(kind)));}});
