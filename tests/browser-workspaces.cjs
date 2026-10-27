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
      if(rpc.name==='review_plantation'){
        const selected=tables.plantations.find(row=>row.id===command.target);
        selected.verification_status=command.decision;selected.revision++;
        tables.mapping_reviews.push({id:'review-'+selected.revision,plantation_id:selected.id,decision:command.decision,reviewed_revision:command.expected_revision,note:command.note,created_at:new Date().toISOString()});
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:selected,error:null}));return;
      }
      if(rpc.name==='save_harvest_batch'){
        const payload=command.p_payload,key=command.p_request_id;
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

  tables.farmers=[{id:'33333333-3333-4333-8333-333333333333',owner_id:owner,full_name:'Sample Farmer',first_name:'Sample',last_name:'Farmer',barangay:'Test barangay',registration_status:'approved',created_at:'2026-01-01'}];
  tables.harvests=[{id:'sample-harvest',owner_id:owner,plantation_id:farm,harvest_date:'2026-01-02',created_at:'2026-01-02',wet_bean_kg:30,dry_bean_kg:10,harvested_pods:100,estimated_value_php:0,area_sqm_at_harvest:10000}];
  const farmerFeatures=new Set(['postharvest','dashboard','reviews','plantation-workspace','farmers','plantations','plantation-form','atlas','trees','posts','history','harvests','batches','pests','treatments','maintenance','tree-events','tree-tags','sync']);
  let checked=0;const failures=[];
  for(const role of ['farmer','field','admin','super_admin']){
    tables.profiles[0].role=role;const folder=role==='super_admin'?'admin':role;
    for(const file of fs.readdirSync(path.join(root,folder)).filter(file=>file.endsWith('.html')&&file!=='mapping.html')){
      const html=fs.readFileSync(path.join(root,folder,file),'utf8'),feature=html.match(/data-feature="([^"]+)"/)?.[1];
      if(role==='farmer'&&!farmerFeatures.has(feature)||role==='admin'&&feature==='users')continue;
      const before=errors.length;
      await send('Emulation.setDeviceMetricsOverride',{width:checked%2?390:1280,height:900,deviceScaleFactor:1,mobile:checked%2===1});
      const suffix=feature==='plantation-workspace'?'?id='+farm:'';
      await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/'+folder+'/'+file+suffix});
      await waitFor(()=>evaluate('document.readyState==="complete"&&location.pathname.endsWith('+JSON.stringify('/'+folder+'/'+file)+')'),'audit '+role+'/'+file);
      await pause(200);
      const state=await evaluate('({status:document.getElementById("page-status")?.textContent||"",formErrors:[...document.querySelectorAll(".status.error")].map(el=>el.textContent.trim()).filter(Boolean),overflow:document.documentElement.scrollWidth>innerWidth+1})');
      if(errors.length>before||state.formErrors.length||state.overflow)failures.push({page:role+'/'+file,...state,errors:errors.slice(before)});
      checked++;
    }
  }
  assert.deepEqual(failures,[]);console.log('PASS '+checked+' authorized workspace screens across farmer, field, administrator and super administrator with desktop/mobile startup and overflow checks.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(send)await Promise.race([send('Browser.close').catch(()=>{}),pause(1000)]);debugSocket?.close();browser?.kill();server?.closeAllConnections();server?.close();});
