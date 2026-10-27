const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(role='field',status='pending',rpcError=null){
 class Element{
  constructor(){this.value='';this.children=[];this.handlers={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
  append(...children){this.children.push(...children);}replaceChildren(...children){this.children=children;}
  addEventListener(name,fn){this.handlers[name]=fn;}async fire(name){await this.handlers[name]?.({preventDefault(){}});}
 }
 const elements=new Map(),ids=['staff-own-panel','staff-inbox','staff-save','staff-review-submit','staff-refresh','staff-filter','staff-search','staff-count','staff-list','staff-detail','staff-review-form','staff-title','staff-facts','staff-history','staff-profile-form','staff-feedback','staff-decision','staff-full-name','staff-phone','staff-address','staff-position','staff-notes'];
 for(const id of ids)elements.set(id,new Element());elements.get('staff-filter').value='pending';
 let row={id:'field-id',full_name:'Field Person',phone:'09123456789',address:'Test address',position:'Field officer',notes:'',registration_status:status,updated_at:'2026-10-27T00:00:00Z'};
 const calls=[],messages=[],navigator={onLine:true};
 const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:()=>new Element()},requireSession:async()=>true,currentAccount:{user:{id:'field-id'},profile:{role,display_name:'Field Person'}},navigator,CacaoApp:{dateTime:v=>v},notify:(...args)=>messages.push(args),listAll:async()=>[{...row}],db:{from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{decision:'rejected',note:'Please correct your address.',created_at:'2026-10-26'}]})})})}),rpc:async(name,args)=>{calls.push({name,args});if(rpcError)return {error:{message:rpcError}};row={...row,...args.p_payload,registration_status:name==='save_field_profile'?'pending':args.decision,updated_at:'2026-10-27T01:00:00Z'};return {data:row};}}});
 context.window=context;vm.runInContext(fs.readFileSync('assets/js/field-profiles.js','utf8').replace('CacaoFieldProfiles.start();',''),context);
 return {api:context.CacaoFieldProfiles,elements,calls,messages,navigator};
}
test('field staff submit their own details with the loaded version for admin review',async()=>{
 const s=setup('field','rejected');await s.api.start();assert(s.elements.get('staff-inbox').classes.has('hidden'));assert(!s.elements.get('staff-own-panel').classes.has('hidden'));
 s.elements.get('staff-address').value='Corrected address';await s.elements.get('staff-profile-form').fire('submit');
 assert.equal(s.calls[0].name,'save_field_profile');assert.equal(s.calls[0].args.expected_updated_at,'2026-10-27T00:00:00Z');assert.equal(s.calls[0].args.p_payload.address,'Corrected address');assert.match(s.elements.get('staff-title').textContent,/Pending/);
});
test('field staff cannot call the approval action even if the hidden form is submitted',async()=>{
 const s=setup();await s.api.start();assert(s.elements.get('staff-review-form').classes.has('hidden'));
 s.elements.get('staff-feedback').value='Attempt to approve own profile';s.elements.get('staff-decision').value='approved';await s.elements.get('staff-review-form').fire('submit');assert.equal(s.calls.length,0);assert.match(s.messages.at(-1)[1],/Only administrators/);
});
test('administrators approve pending staff profiles with written feedback and version checks',async()=>{
 for(const role of ['admin','super_admin']){const s=setup(role);await s.api.start();await s.elements.get('staff-list').children[0].children[0].fire('click');assert(!s.elements.get('staff-review-form').classes.has('hidden'));
 s.elements.get('staff-feedback').value='Staff identity and details verified.';s.elements.get('staff-decision').value='approved';await s.elements.get('staff-review-form').fire('submit');assert.equal(s.calls[0].name,'review_field_profile');assert.equal(s.calls[0].args.target,'field-id');assert.equal(s.calls[0].args.expected_updated_at,'2026-10-27T00:00:00Z');assert(s.elements.get('staff-review-form').classes.has('hidden'));}
});
test('stale reviews preserve feedback; offline submissions do not call the API',async()=>{
 const s=setup('admin','pending','This profile changed. Refresh before review');await s.api.start();await s.elements.get('staff-list').children[0].children[0].fire('click');s.elements.get('staff-feedback').value='Checked staff details carefully.';s.elements.get('staff-decision').value='rejected';await s.elements.get('staff-review-form').fire('submit');assert.equal(s.elements.get('staff-feedback').value,'Checked staff details carefully.');assert.equal(s.elements.get('staff-review-submit').disabled,false);
 const f=setup();await f.api.start();f.navigator.onLine=false;await f.elements.get('staff-profile-form').fire('submit');assert.equal(f.calls.length,0);assert.match(f.messages.at(-1)[1],/Connect/);
});
