const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto').webcrypto;
async function setup(rows=[],role='farmer',blocked=false){
  const elements=new Map(),events={},messages=[],saved=[];
  function element(){return {value:'',files:[],children:[],handlers:{},classList:{add(){},remove(){}},append(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(name,handler){this.handlers[name]=handler;},reset(){}};}
  const $=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};
  const frame={postMessage:(...args)=>messages.push(args)},popup={closed:false,focus(){},postMessage:(...args)=>messages.push(args)};$('boundary-map').contentWindow=frame;
  const classes=new Set();
  const context=vm.createContext({URLSearchParams,crypto,$,currentAccount:{user:{id:'account-a',email:'farmer@example.com'},profile:{role,display_name:'Farmer Account'}},document:{body:{classList:{add:c=>classes.add(c),remove:c=>classes.delete(c)}},createElement:element},location:{origin:'https://cacao.example',pathname:'/farmer/plantation-form',search:''},history:{replaceState(){}},navigator:{onLine:false},notify:(...args)=>messages.push(args),requireSession:async()=>true,listAll:async()=>rows,savePlantation:async record=>{saved.push(record);return {status:'queued'};},humanArea:()=>'',addEventListener:(name,handler)=>events[name]=handler,open:()=>blocked?null:popup});
  context.window=context;
  const source=fs.readFileSync('assets/js/farmer/plantation-form.js','utf8').replace("startForm().catch(error=>notify('page-status',error.message,true));","window.formReady=startForm();");
  vm.runInContext(source,context);await context.formReady;
  return {context,$,events,frame,popup,classes,messages,saved};
}
test('farmer form selects only profiles owned by the signed-in account',async()=>{
  const s=await setup([{id:'mine',owner_id:'account-a',full_name:'My profile',barangay:'Tabuk'},{id:'other',owner_id:'account-b',full_name:'Other profile'}]);
  assert.equal(s.$('farmer-record').children.length,1);assert.equal(s.$('farmer-record').value,'mine');assert.equal(s.$('owner-name').value,'My profile');assert.equal(s.$('farmer-record').disabled,true);
});
test('account-only plantation uses the verified owner without fabricating a farmer record',async()=>{
  const s=await setup();assert.equal(s.$('owner-name').value,'Farmer Account');
  for(const [id,value]of Object.entries({'farm-name':'My farm','barangay':'Tabuk','municipality':'Isabela City','province':'Basilan','tree-count':'10'}))s.$(id).value=value;
  vm.runInContext("mappingReady=true;mappingData={boundary:{type:'Polygon',coordinates:[[[121,6],[122,6],[122,7],[121,6]]]},capture_method:'manual'}",s.context);
  await s.$('plantation-form').handlers.submit({preventDefault(){}});assert.equal(s.saved.length,1);assert.equal(s.saved[0].owner_id,'account-a');assert.equal(s.saved[0].farmer_id,null);assert.equal(s.saved[0].farmer_name,'Farmer Account');
});
test('mapping tab bridge rejects unrelated sources and wrong tokens',async()=>{
  const s=await setup();s.$('open-mapping').handlers.click();
  const bridge=vm.runInContext('mappingBridge',s.context);
  const send=(source,token)=>s.events.message({origin:'https://cacao.example',source,data:{type:'boundary-change',bridge:token,value:{area_sqm:99,boundary:null}}});
  send({},bridge);send(s.popup,'wrong');assert.equal(vm.runInContext('mappingData.area_sqm',s.context),0);
  send(s.popup,bridge);assert.equal(vm.runInContext('mappingData.area_sqm',s.context),99);
});
test('blocked mapping popup expands the map without navigating away from the form',async()=>{
  const s=await setup([], 'farmer',true);s.$('open-mapping').handlers.click();assert(s.classes.has('mapping-expanded'));assert.equal(s.$('close-expanded-map').hidden,false);s.$('close-expanded-map').handlers.click();assert(!s.classes.has('mapping-expanded'));
});
