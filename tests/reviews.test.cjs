const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
function setup({role='admin',status='pending',rpcError=null,allowed=true}={}) {
  class Element {
    constructor(){this.children=[];this.handlers={};this.value='';this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(){}
    addEventListener(event,handler){this.handlers[event]=handler;}
    reset(){elements.get('review-note').value='';elements.get('review-decision').value='';}
    async fire(event){await this.handlers[event]?.({preventDefault(){}});}
  }
  const elements=new Map();
  for(const id of ['review-status','review-decision-form','resubmit-profile','review-search','review-count','review-profiles','review-refresh','review-submit','review-detail','review-title','review-facts','review-edit','review-attachments','review-history','review-help','review-note','review-decision'])elements.set(id,new Element());
  let profile={id:'profile-a',owner_id:'owner',full_name:'Farmer <script>',barangay:'Test',registration_status:status,updated_at:'2026-10-26T01:00:00.000001Z'};
  const calls=[],messages=[];
  const context=vm.createContext({document:{getElementById:id=>elements.get(id),createElement:()=>new Element()},currentAccount:{user:{id:'owner'},profile:{role}},requireSession:async()=>allowed,location:{search:'?farmer=profile-a'},navigator:{onLine:true},URLSearchParams,CacaoApp:{dateTime:v=>v},notify:(...args)=>messages.push(args),getRecord:async()=>({...profile}),listAll:async()=>[{...profile}],db:{from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{decision:'rejected',note:'Please correct the address.',created_at:'2026-10-25'}]})})})}),rpc:async(name,args)=>{calls.push({name,args});if(rpcError)return {error:{message:rpcError}};profile={...profile,registration_status:name==='resubmit_farmer_profile'?'pending':args.decision,updated_at:'2026-10-26T02:00:00Z'};return {data:profile};}}});
  context.window=context;
  vm.runInContext(fs.readFileSync('assets/js/reviews.js','utf8').replace('CacaoReviews.start();',''),context);
  return {api:context.CacaoReviews,elements,calls,messages,navigator:context.navigator};
}
test('review inbox submits written decisions with the viewed profile version',async()=>{
  const s=setup();await s.api.start();s.elements.get('review-note').value='Please correct the address.';s.elements.get('review-decision').value='rejected';await s.elements.get('review-decision-form').fire('submit');
  assert.equal(s.calls[0].name,'review_farmer_profile');assert.equal(s.calls[0].args.expected_updated_at,'2026-10-26T01:00:00.000001Z');assert.equal(s.calls[0].args.note,'Please correct the address.');assert(s.elements.get('review-decision-form').classes.has('hidden'));
});
test('review rejects empty or short feedback before calling the server',async()=>{
  const s=setup();await s.api.start();s.elements.get('review-note').value='  short  ';await s.elements.get('review-decision-form').fire('submit');assert.equal(s.calls.length,0);assert.match(s.messages.at(-1)[1],/10 and 2000/);
});
test('stale decisions preserve feedback and restore the submit button',async()=>{
  const s=setup({rpcError:'This profile changed. Refresh and review the latest submission'});await s.api.start();s.elements.get('review-note').value='Address details checked.';s.elements.get('review-decision').value='approved';await s.elements.get('review-decision-form').fire('submit');assert.match(s.messages.at(-1)[1],/profile changed/);assert.equal(s.elements.get('review-note').value,'Address details checked.');assert.equal(s.elements.get('review-submit').disabled,false);
});
test('farmers can read correction feedback and resubmit without reviewer controls',async()=>{
  const s=setup({role:'farmer',status:'rejected'});await s.api.start();assert(s.elements.get('review-decision-form').classes.has('hidden'));assert(!s.elements.get('resubmit-profile').classes.has('hidden'));assert.equal(s.elements.get('review-history').children[0].children[1].textContent,'Please correct the address.');await s.elements.get('resubmit-profile').fire('click');assert.equal(s.calls[0].name,'resubmit_farmer_profile');assert(s.elements.get('resubmit-profile').classes.has('hidden'));
});
test('field personnel have no approval controls and oversized feedback is rejected',async()=>{
  const s=setup({role:'field'});await s.api.start();assert(s.elements.get('review-decision-form').classes.has('hidden'));
  s.elements.get('review-note').value='Attempt to approve a profile.';s.elements.get('review-decision').value='approved';await s.elements.get('review-decision-form').fire('submit');assert.equal(s.calls.length,0);assert.match(s.messages.at(-1)[1],/Only administrators/);
  assert.throws(()=>s.api.validateNote('x'.repeat(2001)),/2000/);
});
test('offline decisions preserve the note without sending a request',async()=>{
  const s=setup();await s.api.start();s.navigator.onLine=false;s.elements.get('review-note').value='Profile details checked.';s.elements.get('review-decision').value='approved';await s.elements.get('review-decision-form').fire('submit');assert.equal(s.calls.length,0);assert.match(s.messages.at(-1)[1],/Connect/);assert.equal(s.elements.get('review-note').value,'Profile details checked.');
});
