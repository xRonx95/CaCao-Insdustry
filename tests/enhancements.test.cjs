const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function load(file,extra={}){const context=vm.createContext({window:{},...extra});vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);return {...context.window,context};}
const polygon={type:'Polygon',coordinates:[[[121,6],[122,6],[122,7],[121,6]]]};
test('GeoJSON imports preserve polygon coordinates and split multi-parcel documents',()=>{
  const {CacaoIntegrity:integrity}=load('assets/js/record-integrity.js');
  const rows=integrity.parcels({type:'FeatureCollection',features:[{type:'Feature',properties:{name:'Parcel A'},geometry:polygon},{type:'Feature',geometry:{type:'MultiPolygon',coordinates:[polygon.coordinates,polygon.coordinates]}}]});
  assert.equal(rows.length,3);assert.equal(rows[0].geometry.coordinates[0][0][0],121);assert.equal(rows[0].name,'Parcel A');
  assert.throws(()=>integrity.parcels({type:'Polygon',coordinates:[[[121,6],[122,6],[122,7],[121,8]]]}),/closed/);
  assert.throws(()=>integrity.parcels({type:'Polygon',coordinates:[[[181,6],[122,6],[122,7],[181,6]]]}),/valid/);
  assert.throws(()=>integrity.parcels({type:'Polygon',coordinates:[polygon.coordinates[0],polygon.coordinates[0]]}),/holes/);
});
test('duplicate candidates normalize whitespace without merging distinct owner accounts',()=>{
  const {CacaoIntegrity:integrity}=load('assets/js/record-integrity.js');
  const rows=[{id:'a',owner_id:'owner-a',full_name:'ANA   CRUZ',rsbsa_number:'REF-1'},{id:'b',owner_id:'owner-b',full_name:'Ana Cruz'}];
  assert.equal(integrity.duplicates(rows,{first_name:'Ana',last_name:'Cruz',owner_id:'owner-a'}).length,1);
  assert.equal(integrity.duplicates(rows,{first_name:'Ana',last_name:'Cruz',owner_id:'owner-a'},'a').length,0);
  assert.equal(integrity.duplicates(rows,{rsbsa_number:' ref-1 ',owner_id:'other'}).length,1);
});
test('touch-only intersections produce no client overlap warning',()=>{
  let intersection=null;
  const {CacaoIntegrity:integrity}=load('assets/js/record-integrity.js',{turf:{feature:geometry=>({geometry}),intersect:()=>intersection,area:()=>35.4}});
  assert.equal(integrity.overlapArea(polygon,polygon),0);intersection={geometry:polygon};assert.equal(integrity.overlapArea(polygon,polygon),35.4);
});
test('production summaries do not double-count planted area across harvest entries',()=>{
  const {CacaoMonitoring:monitor}=load('assets/js/monitoring.js');
  const rows=[
    {plantation_id:'a',harvest_date:'2026-01-01',created_at:'2026-01-01',wet_bean_kg:100,dry_bean_kg:40,area_sqm_at_harvest:10000},
    {plantation_id:'a',harvest_date:'2026-01-12',created_at:'2026-01-12',wet_bean_kg:100,dry_bean_kg:40,area_sqm_at_harvest:10000},
    {plantation_id:'b',harvest_date:'2026-01-12',created_at:'2026-01-12',wet_bean_kg:50,dry_bean_kg:20,area_sqm_at_harvest:10000}
  ];
  const result=monitor.summarizeHarvest(rows,'month')[0];assert.equal(result.area_sqm,20000);assert.equal(result.dry_bean_kg,100);assert.equal(result.dry_kg_per_ha,50);assert.equal(result.wet_bean_kg,250);
});
test('monitoring validation rejects conflicting harvest weights and partial tree coordinates',()=>{
  const {CacaoMonitoring:monitor}=load('assets/js/monitoring.js');
  assert.throws(()=>monitor.validate({wet_bean_kg:10,dry_bean_kg:20},{table:'harvests',fields:[]}),/cannot exceed/);
  assert.throws(()=>monitor.validate({latitude:6,longitude:null},{table:'cacao_trees',fields:[]}),/both latitude/);
  assert.throws(()=>monitor.validate({status:'absent',hours:8},{table:'worker_attendance',fields:[]}),/zero/);
  assert.throws(()=>monitor.validate({count:Infinity},{table:'test',fields:[['count','Count','integer',true]]}),/finite/);
});
