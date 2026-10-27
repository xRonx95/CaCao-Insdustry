const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(role='farmer'){
 class Element{
  constructor(){this.children=[];this.value='';this.textContent='';this.disabled=false;this.listeners={};const classes=new Set(['hidden']);this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)};}
  append(...nodes){this.children.push(...nodes);}replaceChildren(...nodes){this.children=nodes;}addEventListener(name,fn){this.listeners[name]=fn;}querySelector(){return this.button;}setAttribute(){}
 }
 const ids=['history-farm','history-map','review-panel','mapping-review-form','boundary-body','overlap-list','gps-session-list','gps-points-body','review-list','history-log','gps-points-panel','history-summary','mapping-decision','history-refresh','review-note','review-decision'];
 const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));elements['mapping-review-form'].elements=[new Element(),new Element()];elements['mapping-review-form'].button=new Element();
 const calls=[],rpc=[],maps=[],messages=[];
 const farms=[{id:'mine',owner_id:'owner',name:'My farm',farmer_name:'Farmer',revision:2,verification_status:'rejected',area_sqm:100},{id:'other',owner_id:'other-owner',name:'Other farm',farmer_name:'Other',revision:1,verification_status:'pending',area_sqm:200}];
 const tables={plantations:farms,plantation_boundaries:[{id:'v1',plantation_id:'mine',revision:1,area_sqm:100}],gps_tracking_sessions:[{id:'s1',plantation_id:'mine',boundary_revision:1}],gps_tracking_points:[{id:'p1',session_id:'s1',sequence_no:1,accepted:true}],mapping_reviews:[{plantation_id:'mine',decision:'rejected',reviewed_revision:1,note:'Please correct the eastern corner.'}],plantation_overlap_flags:[],activity_logs:[]};
 let authorized=[farms[0]];
 class Query{
  constructor(table){this.table=table;this.filters=[];this.from=0;this.to=499;calls.push(this);}
  select(){return this;}eq(key,id){this.filters.push([key,id]);return this;}order(){return this;}range(from,to){this.from=from;this.to=to;return this;}
  data(){return tables[this.table].filter(row=>this.filters.every(([key,id])=>row[key]===id)).slice(this.from,this.to+1);}
  then(resolve){return Promise.resolve({data:this.data(),error:null}).then(resolve);}single(){return Promise.resolve({data:this.data()[0],error:null});}
 }
 const context=vm.createContext({window:{},document:{getElementById:id=>elements[id],createElement:()=>new Element()},currentAccount:{user:{id:'owner'},profile:{role}},URLSearchParams,location:{search:''},requireSession:async()=>true,listPlantations:async()=>authorized,db:{from:table=>new Query(table),rpc:(name,args)=>{rpc.push([name,args]);return Promise.resolve({data:{...farms[0],verification_status:args.decision},error:null});}},notify:(...args)=>messages.push(args),CacaoApp:{drawMap:rows=>maps.push(rows),dateTime:value=>value||''},CacaoIntegrity:{download(){}},confirm:()=>true});
 vm.runInContext(fs.readFileSync('assets/js/enhancements.js','utf8'),context);
 return {api:context.window.CacaoEnhance,elements,calls,rpc,maps,messages,setAuthorized:rows=>{authorized=rows;},farms};
}
test('farmer plantations and selected history use account and plantation IDs',async()=>{
 const s=setup();await s.api.start('history');
 assert(s.calls.some(q=>q.table==='plantations'&&q.filters.some(([key,id])=>key==='owner_id'&&id==='owner')));
 assert.equal(s.elements['history-farm'].children.filter(option=>option.value==='other').length,0);
 for(const table of ['plantation_boundaries','gps_tracking_sessions','mapping_reviews'])assert(s.calls.some(q=>q.table===table&&q.filters.some(([key,id])=>key==='plantation_id'&&id==='mine')),table);
 assert.match(s.elements['mapping-decision'].textContent,/Rejected/);assert.match(s.elements['mapping-decision'].textContent,/eastern corner/);
 assert.equal(s.elements['review-panel'].classList.contains('hidden'),true);
 await s.elements['mapping-review-form'].listeners.submit({preventDefault(){},target:s.elements['mapping-review-form']});assert.equal(s.rpc.length,0);
});
test('administrator uses authorized plantations and can submit a boundary review',async()=>{
 const s=setup('admin');await s.api.start('history');assert.equal(s.elements['history-farm'].children.filter(option=>option.value==='other').length,0);
 assert.equal(s.elements['review-panel'].classList.contains('hidden'),false);s.elements['review-decision'].value='verified';s.elements['review-note'].value='Boundary checked and accepted.';
 await s.elements['mapping-review-form'].listeners.submit({preventDefault(){},target:s.elements['mapping-review-form']});
 assert.equal(s.rpc.length,1);assert.equal(s.rpc[0][0],'review_plantation');assert.equal(s.rpc[0][1].target,'mine');assert.equal(s.rpc[0][1].expected_revision,2);
});
test('field staff cannot review; changing selection clears the old GPS samples',async()=>{
 const s=setup('field');await s.api.start('history');assert.equal(s.api.canReview('field'),false);
 s.elements['gps-points-body'].append({textContent:'old samples'});s.elements['history-farm'].value='';await s.elements['history-farm'].listeners.change();
 assert.equal(s.elements['gps-points-body'].children.length,0);assert.equal(s.elements['mapping-decision'].textContent,'');assert.equal(s.elements['review-panel'].classList.contains('hidden'),true);
});
test('empty administrator directory explains assignments and refresh discovers newly authorized farms',async()=>{
 const s=setup('admin');s.setAuthorized([]);await s.api.start('history');
 assert.equal(s.elements['history-farm'].disabled,true);assert.match(s.elements['mapping-decision'].textContent,/super administrator/);
 s.setAuthorized([s.farms[0]]);await s.elements['history-refresh'].listeners.click();
 assert.equal(s.elements['history-farm'].disabled,false);assert.equal(s.elements['history-farm'].value,'mine');assert.match(s.elements['mapping-decision'].textContent,/eastern corner/);
});
