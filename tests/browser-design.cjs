// Dashboard presentation checks with isolated fixtures, never operational data.
// Run: node tests/browser-design.cjs (Chrome required; optional CHROME_PATH).
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const owner='11111111-1111-4111-8111-111111111111',farm='22222222-2222-4222-8222-222222222222';
const tables={
  profiles:[{id:owner,display_name:'Test Farmer',role:'admin',account_status:'active'}],
  plantations:[{id:farm,owner_id:owner,farmer_id:'33333333-3333-4333-8333-333333333333',name:'Integration test farm',farmer_name:'Test Farmer',barangay:'Test barangay',municipality:'Isabela City',province:'Basilan',area_sqm:10000,tree_count:10,revision:1,status:'active',created_at:'2026-01-01',updated_at:'2026-01-01',boundary:null}],
  harvests:[],farmers:[],workers:[],pest_reports:[]
};
const receipts=new Map(),unavailableTables=new Set();let dropped=false,rpcCalls=0,server,send,browser,debugSocket;
function fixtures(){
  class Query{
    constructor(table){this.table=table;this.filters=[];this.from=0;this.to=9999;}
    select(){return this;}order(){return this;}limit(size){this.to=size-1;return this;}eq(key,value){this.filters.push([key,value]);return this;}
    range(from,to){this.from=from;this.to=to;return this;}
    async response(single=false){
      const data=await (await fetch('/__test_data?table='+encodeURIComponent(this.table))).json();
      if(data.error)throw new Error(data.error);
      const rows=data.filter(row=>this.filters.every(([key,value])=>row[key]===value)).slice(this.from,this.to+1);
      return {data:single?rows[0]||null:rows,error:null};
    }
    then(resolve,reject){return this.response().then(resolve,reject);}single(){return this.response(true);}
  }
  const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',app_metadata:{role:'admin'}};
  const client={auth:{getSession:async()=>({data:{session:{user}},error:null}),getUser:async()=>({data:{user},error:null}),onAuthStateChange(){},signOut:async()=>({error:null})},from:table=>new Query(table),rpc:async(name,body)=>{
    try{const response=await fetch('/__test_rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,body})});return response.json();}
    catch(error){return {error:{message:error.message}};}
  }};
  Object.defineProperty(window,'CACAO_SUPABASE_URL',{get:()=> 'https://fixture-only.supabase.co',set(){}});
  Object.defineProperty(window,'CACAO_SUPABASE_KEY',{get:()=> 'sb_publishable_fixture_public_key_not_real',set(){}});
  Object.defineProperty(window,'supabase',{get:()=>({createClient:()=>client}),set(){}});
}
async function waitFor(callback,label,timeout=20000){const start=Date.now();while(Date.now()-start<timeout){if(await callback())return;await pause(50);}throw new Error('Timed out: '+label);}
async function main(){
  server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/__test_data'){const table=url.searchParams.get('table');res.setHeader('Content-Type','application/json');res.end(JSON.stringify(unavailableTables.has(table)?{error:'Fixture request failed'}:tables[table]||[]));return;}
    if(url.pathname==='/__test_rpc'){
      let body='';for await(const part of req)body+=part;
      const rpc=JSON.parse(body),command=rpc.body;rpcCalls++;
      if(rpc.name==='record_postharvest'){
        tables.postharvest_records??=[];
        if(!receipts.has(command.p_request_id)){
          const p=command.p_payload,b=tables.harvest_batches.find(row=>row.id===p.batch_id);
          const row={...p,id:command.p_request_id,owner_id:b.owner_id,actor_id:owner,actor_role:tables.profiles[0].role,stage_snapshot:b.stage,weight_snapshot_kg:b.current_weight_kg,created_at:new Date().toISOString()};
          tables.postharvest_records.push(row);receipts.set(command.p_request_id,row);
        }
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:receipts.get(command.p_request_id),error:null}));return;
      }
      if(rpc.name==='review_plantation'){
        const selected=tables.plantations.find(row=>row.id===command.target);
        selected.verification_status=command.decision;selected.revision++;
        tables.mapping_reviews.push({id:'review-'+selected.revision,plantation_id:selected.id,decision:command.decision,reviewed_revision:command.expected_revision,note:command.note,created_at:new Date().toISOString()});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:selected,error:null}));return;
      }
      if(rpc.name==='save_harvest_batch'){
        const payload=command.p_payload,key=command.p_request_id;
        if(payload.stage==='stored'){
          const evidence=(tables.postharvest_records||[]).filter(row=>row.batch_id===payload.batch_id);
          if(!evidence.some(row=>row.kind==='protocol')||!evidence.some(row=>row.kind==='quality'&&row.detail.grade!=='ungraded')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:{code:'P0001',message:'Record an agreed protocol and quality assessment before storage'}}));return;}
        }
        tables.harvest_batches??=[];tables.harvest_batch_events??=[];
        if(!receipts.has(key)){
          let batch;
          if(payload.action==='create'){
            const source=tables.harvests.find(row=>row.id===payload.harvest_id);
            batch={id:key,owner_id:owner,plantation_id:source.plantation_id,harvest_id:source.id,code:payload.code,allocated_wet_kg:payload.weight_kg,current_weight_kg:payload.weight_kg,stage:'harvested',stage_on:payload.event_on,revision:1};tables.harvest_batches.push(batch);
          }else{
            batch=tables.harvest_batches.find(row=>row.id===payload.batch_id);
            Object.assign(batch,{stage:payload.stage,stage_on:payload.event_on,current_weight_kg:payload.weight_kg,revision:batch.revision+1});
            for(const key of ['quality_result','moisture_pct','buyer','sale_php'])if(payload[key]!=null)batch[key]=payload[key];
          }
          tables.harvest_batch_events.push({id:key,batch_id:batch.id,owner_id:owner,stage:batch.stage,event_on:payload.event_on,weight_kg:payload.weight_kg,revision:batch.revision,note:payload.note,quality_result:payload.quality_result,moisture_pct:payload.moisture_pct,buyer:payload.buyer,sale_php:payload.sale_php,created_at:new Date().toISOString()});
          receipts.set(key,batch);
        }
        if(!dropped){dropped=true;res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Acknowledgement unavailable after fixture commit'}}));return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:receipts.get(key),error:null}));return;
      }
      if(!receipts.has(command.change_id)){
        const row={...command.payload,id:command.record_id,area_sqm_at_harvest:10000,dry_kg_per_ha:Number(command.payload.dry_bean_kg),updated_at:new Date().toISOString(),created_at:new Date().toISOString()};
        (tables[command.entity]||=[]).push(row);receipts.set(command.change_id,row);
      }
      // Deliberately lose the first acknowledgement after the fixture server commits.
      if(!dropped){dropped=true;req.socket.destroy();return;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{confirmed:true,replayed:true,record:receipts.get(command.change_id)},error:null}));return;
    }
    const requested=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!requested.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
    fs.readFile(requested,(error,data)=>{
      if(error){res.writeHead(404);res.end();return;}
      const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon'};
      res.setHeader('Content-Type',mime[path.extname(requested)]||'application/octet-stream');
      const settings=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
      for(const header of settings.headers[0].headers)res.setHeader(header.key,header.value);
      res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cacao-browser-field-'));
  const chrome=process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if(!fs.existsSync(chrome))throw new Error('Set CHROME_PATH to an installed Chromium browser.');
  browser=spawn(chrome,['--headless','--no-sandbox','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
  const portFile=path.join(profile,'DevToolsActivePort');
  let debugPort;
  await waitFor(()=>{try{debugPort=fs.readFileSync(portFile,'utf8').split('\n')[0];return /^\d+$/.test(debugPort);}catch{return false;}},'Chrome debugger startup');
  const target=await(await fetch('http://127.0.0.1:'+debugPort+'/json/new?about:blank',{method:'PUT'})).json();
  const ws=new WebSocket(target.webSocketDebuggerUrl);debugSocket=ws;await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map(),events=new Map(),errors=[];
  ws.onmessage=({data})=>{
    const message=JSON.parse(data);
    if(message.id){const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(message.error):item.resolve(message.result);}
    else{
      if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
      const listener=events.get(message.method);if(listener){events.delete(message.method);listener();}
    }
  };
  send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;const timer=setTimeout(()=>reject(new Error('CDP timeout: '+method)),30000);pending.set(next,{resolve,reject,timer});ws.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>{const value=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(value.exceptionDetails)throw new Error(value.exceptionDetails.exception?.description||value.exceptionDetails.text);return value.result.value;};
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'('+fixtures.toString()+')()'});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/admin/admin.html'});
  try{await waitFor(()=>evaluate('!!document.getElementById("workflow-dashboard")'),'dashboard render');}catch(error){console.log(await evaluate('({url:location.href,status:document.getElementById("page-status")?.textContent})'));console.log(errors);throw error;}
  await pause(500);
  const order=await evaluate('({heading:document.querySelector(".page-heading").getBoundingClientRect().top,stats:document.querySelector(".primary-stats").getBoundingClientRect().top,actions:document.getElementById("workflow-dashboard").getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth+1,emptyCharts:document.querySelectorAll(".chart-empty").length})');
  assert(order.heading<order.stats&&order.stats<order.actions,JSON.stringify(order));assert.equal(order.overflow,false);assert(order.emptyCharts>=3);
  for(const width of [1440,1080,851]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
    await pause(300);
    assert.equal(await evaluate('getComputedStyle(document.getElementById("nav-toggle")).display'),'none','Desktop menu must be hidden at '+width);
    assert.equal(await evaluate('document.querySelector(".topbar .brand").getBoundingClientRect().left<80'),true,'Brand must align left at '+width);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Desktop overflow at '+width);
    assert.equal(await evaluate('getComputedStyle(document.body).backgroundColor'),'rgb(243, 246, 244)','Desktop keeps the light theme');
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'cacao-professional-desktop.png'),Buffer.from(shot.data,'base64'));
  for(const width of [850,390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Mobile overflow '+width);assert.notEqual(await evaluate('getComputedStyle(document.getElementById("nav-toggle")).display'),'none','Mobile menu must be visible at '+width);assert.equal(await evaluate('document.querySelector("#nav-toggle svg").getBoundingClientRect().width>0'),true,'Menu icon must be visible');}
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'cacao-professional-mobile-overview.png'),Buffer.from(shot.data,'base64'));
  await evaluate('document.getElementById("nav-toggle").click()');assert.equal(await evaluate('document.getElementById("nav-toggle").getAttribute("aria-expanded")'),'true');
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'cacao-professional-mobile.png'),Buffer.from(shot.data,'base64'));
  tables.profiles[0].role='farmer';
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/farmer.html'});
  await waitFor(()=>evaluate('!!document.querySelector("#farmer-daily .farmer-farm-row")'),'farmer daily home');
  for(const width of [1440,390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<850});await pause(150);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'farmer home overflow '+width);
    assert.equal(await evaluate('document.querySelectorAll(".farmer-actions a").length'),4);
    assert.equal(await evaluate('document.querySelector(".farmer-farm-row strong").textContent'),'Integration test farm');
    if(width===390){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(os.tmpdir(),'caaps-farmer-home.png'),Buffer.from(shot.data,'base64'));}
  }
  await waitFor(()=>evaluate('!!document.querySelector(".farmer-guide")'),'getting started guide');
  assert.equal(await evaluate('document.querySelectorAll(".farmer-guide li").length'),5);
  await evaluate('document.querySelector(".farmer-guide select").value="fil";document.querySelector(".farmer-guide select").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.querySelector(".farmer-guide h3").textContent'),'Gabay sa pagsisimula');
  unavailableTables.add('harvests');
  await send('Page.reload');
  await waitFor(()=>evaluate('document.getElementById("stat-dry")?.textContent==="Unavailable"'),'failed harvest total');
  assert.equal(await evaluate('document.getElementById("stat-farms").textContent'),'1');
  assert.equal(await evaluate('document.getElementById("recent-activity").textContent.includes("No activity recorded")'),true);
  assert.equal(await evaluate('document.getElementById("production-overview-chart").parentElement.textContent.includes("Records could not be loaded")'),true);
  await waitFor(()=>evaluate('document.querySelector(".farmer-guide li:nth-child(4)")?.textContent.includes("Hindi makuha")'),'unavailable guide step');
  unavailableTables.clear();
  tables.harvests=Array.from({length:18},(_,index)=>({id:'harvest-'+index,owner_id:owner,plantation_id:farm,harvest_date:'2026-06-'+String(index+1).padStart(2,'0'),created_at:'2026-06-30',wet_bean_kg:30,dry_bean_kg:10,harvested_pods:100,estimated_value_php:0,area_sqm_at_harvest:10000}));
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/harvests.html'});
  await waitFor(()=>evaluate('document.getElementById("monitor-count")?.textContent.startsWith("18 records")'),'harvest report records');
  assert.equal(await evaluate('document.querySelectorAll("#monitor-body tr").length'),15);
  await evaluate('window.dispatchEvent(new Event("beforeprint"))');
  assert.equal(await evaluate('document.querySelectorAll("#monitor-body tr").length'),18,'Print includes all filtered rows');
  assert.equal(await evaluate('document.querySelector(".monitor-print-context").textContent.includes("18 matching records")'),true);
  await evaluate('window.dispatchEvent(new Event("afterprint"))');
  assert.equal(await evaluate('document.querySelectorAll("#monitor-body tr").length'),15,'Normal pagination returns after printing');
  await evaluate('document.getElementById("monitor-from").value="2026-06-15";document.getElementById("monitor-from").dispatchEvent(new Event("change"));window.dispatchEvent(new Event("beforeprint"))');
  assert.equal(await evaluate('document.querySelectorAll("#monitor-body tr").length'),4,'Print respects date filters');
  await evaluate('window.dispatchEvent(new Event("afterprint"))');
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/batches.html'});
  await waitFor(()=>evaluate('document.getElementById("batch-harvest")?.options.length===19'),'batch source harvests');
  for(const width of [1280,390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<850});await pause(120);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'batch page overflow '+width);}
  await evaluate('document.getElementById("batch-harvest").selectedIndex=1;document.getElementById("batch-created-on").value="2026-06-01";document.getElementById("batch-code").value="TEST-LOT-1";document.getElementById("batch-wet-kg").value="10";document.getElementById("batch-create-note").value="Isolated browser sample";document.getElementById("batch-create-form").requestSubmit()');
  try{await waitFor(()=>evaluate('document.getElementById("batch-retry").hidden===false'),'uncertain batch confirmation');}catch(error){console.error(await evaluate('({status:document.getElementById("page-status").textContent,invalid:[...document.querySelectorAll("#batch-create-form :invalid")].map(el=>[el.id,el.value,el.validationMessage]),overview:document.getElementById("batch-overview").textContent})'));throw error;}
  assert.equal(tables.harvest_batches.length,1);
  await evaluate('document.getElementById("batch-retry").click()');
  await waitFor(()=>evaluate('document.getElementById("batch-overview").textContent.includes("Revision 1")'),'confirmed batch creation');
  assert.equal(tables.harvest_batches.length,1);assert.equal(tables.harvest_batch_events.length,1);
  const advance=async(stage,weight,revision,quality)=>{
    await evaluate('document.getElementById("batch-event-on").value='+JSON.stringify({2:'2026-06-01',3:'2026-06-06',4:'2026-06-08',5:'2026-06-09',6:'2026-06-10',7:'2026-06-11'}[revision]));
    await evaluate(`(()=>{const $=id=>document.getElementById(id);$('batch-stage').value=${JSON.stringify(stage)};$('batch-stage').dispatchEvent(new Event('change'));$('batch-event-weight').value=${JSON.stringify(weight)};$('batch-event-note').value='Recorded field observation';${quality?"$('batch-moisture').value='7';$('batch-quality-result').value="+JSON.stringify(quality)+';':''}${stage==='sold'?"$('batch-buyer').value='Sample buyer';$('batch-sale-php').value='1200';":''}$('batch-advance-form').requestSubmit();})()`);
    await waitFor(()=>evaluate('document.getElementById("batch-overview").textContent.includes("Revision '+revision+'")'),'batch '+stage);
  };
  await advance('fermenting','10',2);await advance('drying','4',3);await advance('quality_check','4',4,'hold');
  assert.equal(await evaluate('[...document.getElementById("batch-stage").options].some(option=>option.value==="stored")'),false,'Hold cannot proceed to storage');
  await advance('quality_check','4',5,'pass');
  await evaluate('document.getElementById("batch-stage").value="stored";document.getElementById("batch-stage").dispatchEvent(new Event("change"));document.getElementById("batch-event-note").value="Attempt without supporting evidence";document.getElementById("batch-advance-form").requestSubmit()');
  await waitFor(()=>evaluate('document.getElementById("page-status").textContent.includes("agreed protocol")'),'storage evidence gate');
  const trackedBatch=tables.harvest_batches[0];
  tables.postharvest_records=[{id:'stage-protocol',batch_id:trackedBatch.id,owner_id:owner,kind:'protocol',detail:{started_at:'2026-06-01T00:00:00Z',min_hours:120,max_moisture:8,max_defects:5},observed_at:'2026-06-01T00:00:00Z'},{id:'stage-grade',batch_id:trackedBatch.id,owner_id:owner,actor_role:'field',kind:'quality',detail:{grade:'standard',moisture_pct:7,sample_beans:100,moldy:0,slaty:1,insect_damaged:0},observed_at:'2026-06-09T00:00:00Z'}];
  await advance('stored','4',6);await advance('sold','4',7);
  assert.equal(tables.harvest_batch_events.length,7);
  assert.equal(await evaluate('document.getElementById("batch-advance-form").hidden'),true,'Sold batch is complete');
  assert.equal(await evaluate('document.querySelectorAll("#batch-timeline li").length'),7);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:true});
  const batchShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(os.tmpdir(),'caaps-batch-tracking.png'),Buffer.from(batchShot.data,'base64'));
  const secondFarm='44444444-4444-4444-8444-444444444444';
  tables.plantations[0].verification_status='rejected';
  tables.plantations.push({...tables.plantations[0],id:secondFarm,name:'Second test farm',verification_status:'pending'});
  tables.plantations.push({...tables.plantations[0],id:'unrelated',owner_id:'another-owner',name:'Private unrelated farm'});
  tables.plantation_boundaries=[{id:'version-1',plantation_id:farm,revision:1,recorded_at:'2026-06-01',area_sqm:10000,capture_method:'gps',boundary_geojson:null},{id:'version-2',plantation_id:secondFarm,revision:2,recorded_at:'2026-06-02',area_sqm:20000,capture_method:'gps',boundary_geojson:null}];
  tables.gps_tracking_sessions=[{id:'session-1',plantation_id:farm,created_at:'2026-06-01',boundary_revision:1},{id:'session-2',plantation_id:secondFarm,created_at:'2026-06-02',boundary_revision:2}];
  tables.gps_tracking_points=[{id:'point-1',session_id:'session-1',sequence_no:1,latitude:6.7,longitude:121.9,accuracy:5,accepted:true,captured_at:'2026-06-01'}];
  tables.mapping_reviews=[{id:'review-1',plantation_id:farm,decision:'rejected',reviewed_revision:1,note:'Please correct the eastern corner.',created_at:'2026-06-01'}];
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/history.html?plantation='+farm});
  await waitFor(()=>evaluate('document.getElementById("mapping-decision")?.textContent.includes("eastern corner")'),'farmer administrator feedback');
  assert.equal(await evaluate('[...document.getElementById("history-farm").options].some(option=>option.value==="unrelated")'),false);
  assert.equal(await evaluate('document.getElementById("review-panel").classList.contains("hidden")'),true);
  await evaluate('document.querySelector("#gps-session-list button").click()');
  await waitFor(()=>evaluate('document.querySelectorAll("#gps-points-body tr").length===1'),'selected plantation GPS samples');
  await evaluate('document.getElementById("history-farm").value='+JSON.stringify(secondFarm)+';document.getElementById("history-farm").dispatchEvent(new Event("change"))');
  await waitFor(()=>evaluate('document.getElementById("history-summary").textContent.includes("Second test farm")'),'changed plantation history');
  assert.equal(await evaluate('document.querySelectorAll("#gps-points-body tr").length'),0);
  assert.equal(await evaluate('document.querySelector("#boundary-body td").textContent'),'2');
  assert.equal(await evaluate('document.getElementById("mapping-decision").textContent.includes("Pending")'),true);
  tables.profiles[0].role='admin';tables.plantations=tables.plantations.filter(row=>row.id!=='unrelated');
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/admin/history.html?plantation='+farm});
  await waitFor(()=>evaluate('!document.getElementById("review-panel")?.classList.contains("hidden")'),'administrator boundary controls');
  await send('Page.handleJavaScriptDialog',{accept:true}).catch(()=>{});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:'window.confirm=()=>true;'});
  await evaluate('window.confirm=()=>true;document.getElementById("review-decision").value="verified";document.getElementById("review-note").value="Boundary checked and accepted.";document.getElementById("mapping-review-form").requestSubmit()');
  await waitFor(()=>evaluate('document.getElementById("mapping-decision").textContent.includes("Verified by administrator")'),'administrator verification saved');
  await evaluate('document.querySelector("#boundary-body button").click()');
  assert.equal(await evaluate('document.getElementById("review-panel").classList.contains("hidden")'),true,'Historical preview cannot be approved as current');
  await evaluate('document.getElementById("history-refresh").click()');
  await waitFor(()=>evaluate('!document.getElementById("review-panel").classList.contains("hidden")'),'restore current boundary for review');
  const restoredPlantations=tables.plantations;tables.plantations=[];
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/admin/history.html'});
  await waitFor(()=>evaluate('document.getElementById("history-farm")?.disabled&&document.getElementById("mapping-decision").textContent.includes("super administrator")'),'empty administrator access guidance');
  assert.equal(await evaluate('getComputedStyle(document.getElementById("history-map")).display'),'none','Empty history does not show a blank map');
  await waitFor(()=>evaluate('document.getElementById("workspace-access")?.textContent.includes("No farmer accounts are assigned")'),'assignment diagnosis');
  tables.plantations=restoredPlantations;tables.staff_farmer_assignments=[{staff_id:owner,farmer_owner_id:'newly-assigned-farmer'}];
  await evaluate('document.getElementById("history-refresh").click()');
  await waitFor(()=>evaluate('!document.getElementById("history-farm").disabled&&document.getElementById("history-farm").options.length===3'),'directory refresh after access changes');
  await waitFor(()=>evaluate('document.getElementById("workspace-access").textContent.includes("1 farmer account")'),'updated assignment guidance');
  tables.harvest_batches=[{id:'quality-demo',owner_id:owner,plantation_id:farm,code:'DEMO-ZDN-001',stage:'sold',current_weight_kg:40,allocated_wet_kg:120,sale_php:4000}];
  const observation=(id,kind,detail,date)=>({id,batch_id:'quality-demo',owner_id:owner,actor_role:'field',kind,detail,observed_at:date,created_at:date,weight_snapshot_kg:40,note:'Fictional demonstration record'});
  tables.postharvest_records=[observation('protocol','protocol',{facility:'Sample cooperative facility',reference:'Demonstration targets — not a buyer contract',started_at:'2026-06-01T00:00:00Z',min_hours:120,turn_hours:24,max_moisture:8,max_defects:5},'2026-06-01T00:00:00Z'),observation('dry-1','drying',{moisture_pct:24,method:'solar',weather:'dry',protected:true},'2026-06-07T00:00:00Z'),observation('dry-2','drying',{moisture_pct:12,method:'solar',weather:'dry',protected:true},'2026-06-08T00:00:00Z'),observation('grade','quality',{moisture_pct:7,sample_beans:100,moldy:0,slaty:1,insect_damaged:1,grade:'premium',assessor:'Sample assigned reviewer'},'2026-06-09T00:00:00Z')];
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/admin/postharvest.html'});
  await waitFor(()=>evaluate('document.getElementById("process-sales")?.textContent.includes("4,000")'),'post-harvest metrics');
  await evaluate('document.getElementById("process-kind").value="cost";document.getElementById("process-kind").dispatchEvent(new Event("change"));document.getElementById("process-amount_php").value="600";document.getElementById("process-note").value="Example processing receipt";document.getElementById("process-form").requestSubmit()');
  await waitFor(()=>evaluate('document.getElementById("process-costs").textContent.includes("600")'),'processing cost saved');
  await evaluate('document.querySelector("#process-history button").click();document.getElementById("process-amount_php").value="400";document.getElementById("process-note").value="Corrected example receipt";document.getElementById("process-form").requestSubmit()');
  await waitFor(()=>evaluate('document.getElementById("process-costs").textContent.includes("400")'),'corrected cost counted once');
  assert.equal(await evaluate('document.getElementById("process-margin").textContent.includes("3,600")'),true);
  assert.equal(tables.postharvest_records.filter(row=>row.kind==='cost').length,2);
  for(const width of [1280,390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<850});await pause(160);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'post-harvest overflow '+width);}
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:780,deviceScaleFactor:1,mobile:false});await pause(200);
  await evaluate('document.querySelector(".process-hero .eyebrow").textContent="FICTIONAL DEMONSTRATION DATA · NOT PILOT RESULTS"');
  const qualityShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'caaps-postharvest-workspace.png'),Buffer.from(qualityShot.data,'base64'));
  tables.profiles[0].role='farmer';
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/postharvest.html'});
  await waitFor(()=>evaluate('!!document.querySelector("#process-kind option")'),'farmer process controls');
  assert.equal(await evaluate('[...document.getElementById("process-kind").options].some(option=>option.value==="protocol")'),false);
  await evaluate('document.getElementById("process-kind").value="quality";document.getElementById("process-kind").dispatchEvent(new Event("change"))');
  assert.equal(await evaluate('document.getElementById("process-grade").options.length'),1);
  assert.equal(await evaluate('document.getElementById("process-grade").value'),'ungraded');
  for(const page of ['help.html','demo.html','postharvest-guide.html']){
    await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'+page});
    await waitFor(()=>evaluate('document.readyState==="complete"&&!!document.querySelector(".guide-header")'),'guide '+page);
    assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,page+' overflow');
  }
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS dashboard hierarchy, daily farmer actions, responsive overflow, and menu behavior.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(send)await Promise.race([send('Browser.close').catch(()=>{}),pause(1000)]);debugSocket?.close();browser?.kill();server?.closeAllConnections();server?.close();});
