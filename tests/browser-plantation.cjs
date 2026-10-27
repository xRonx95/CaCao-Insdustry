// Farmer ownership and mapping-tab integration with isolated fixtures.
// Run: node tests/browser-plantation.cjs (Chrome required).
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const owner='11111111-1111-4111-8111-111111111111',farm='22222222-2222-4222-8222-222222222222';
const tables={
  profiles:[{id:owner,display_name:'Test Farmer',role:'farmer',account_status:'active'}],
  plantations:[{id:farm,owner_id:owner,farmer_id:'33333333-3333-4333-8333-333333333333',name:'Integration test farm',farmer_name:'Test Farmer',barangay:'Test barangay',municipality:'Isabela City',province:'Basilan',area_sqm:10000,tree_count:10,revision:1,status:'active',created_at:'2026-01-01',updated_at:'2026-01-01',boundary:null}],
  harvests:[],farmers:[],workers:[],pest_reports:[]
};
const receipts=new Map();let dropped=false,rpcCalls=0,server,send,browser,debugSocket;
function fixtures(){
  class Query{
    constructor(table){this.table=table;this.filters=[];this.from=0;this.to=9999;}
    select(){return this;}order(){return this;}eq(key,value){this.filters.push([key,value]);return this;}
    range(from,to){this.from=from;this.to=to;return this;}
    async response(single=false){
      const data=await (await fetch('/__test_data?table='+encodeURIComponent(this.table))).json();
      const rows=data.filter(row=>this.filters.every(([key,value])=>row[key]===value)).slice(this.from,this.to+1);
      return {data:single?rows[0]||null:rows,error:null};
    }
    then(resolve,reject){return this.response().then(resolve,reject);}single(){return this.response(true);}
  }
  const user={id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',app_metadata:{role:'farmer'}};
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
    if(url.pathname==='/__test_data'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(tables[url.searchParams.get('table')]||[]));return;}
    if(url.pathname==='/__test_rpc'){
      let body='';for await(const part of req)body+=part;
      const command=JSON.parse(body).body;rpcCalls++;
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
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/plantation-form.html'});
  await waitFor(()=>evaluate('document.getElementById("owner-name")?.value==="Test Farmer"'),'account selected');
  assert.equal(await evaluate('document.getElementById("farmer-record").disabled'),true);
  assert.equal(await evaluate('document.getElementById("farmer-form-dialog").open'),false);
  await evaluate('document.getElementById("open-farmer-form").click()');
  assert.equal(await evaluate('document.getElementById("farmer-form-dialog").open'),true);
  for(const width of [1280,390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<850});
    await pause(150);
    assert.equal(await evaluate('(()=>{const d=document.getElementById("farmer-form-dialog");return d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().right<=innerWidth})()'),true,'Plantation modal overflow '+width);
  }
  await send('Runtime.evaluate',{expression:'document.getElementById("open-mapping").click()',userGesture:true});
  let popupTarget;
  await waitFor(async()=>{const targets=await(await fetch('http://127.0.0.1:'+debugPort+'/json/list')).json();popupTarget=targets.find(item=>item.type==='page'&&item.url.includes('/farmer/mapping.html?full=1'));return !!popupTarget;},'mapping tab');
  const popupSocket=new WebSocket(popupTarget.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{popupSocket.onopen=resolve;popupSocket.onerror=reject;});
  let popupId=0;const requests=new Map();popupSocket.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){const request=requests.get(message.id);requests.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}};
  popupSocket.onclose=()=>{for(const request of requests.values())request.reject(new Error('Popup closed'));requests.clear();};
  const popupSend=(method,params={})=>new Promise((resolve,reject)=>{const id=++popupId;requests.set(id,{resolve,reject});popupSocket.send(JSON.stringify({id,method,params}));});
  const popupEvaluate=async expression=>(await popupSend('Runtime.evaluate',{expression,returnByValue:true})).result?.value;
  await popupSend('Runtime.enable');await popupSend('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await waitFor(()=>evaluate('mappingTabReady===true'),'mapping handshake');
  await evaluate('mappingData={boundary:{type:"Polygon",coordinates:[[[121.97,6.7],[121.971,6.7],[121.971,6.701],[121.97,6.7]]]},capture_method:"manual",gps_accuracy:[],gps_samples:[]};sendBoundary()');
  await pause(700);
  await waitFor(async()=>Number(await popupEvaluate('document.getElementById("area-ha").textContent.split(" ")[0]'))>0,'boundary received');
  assert.equal(await popupEvaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  assert.equal(await popupEvaluate('document.getElementById("map").getBoundingClientRect().height>=320'),true);
  popupEvaluate('document.querySelector(".mapping-return-bar button").click()').catch(()=>{});
  await waitFor(()=>evaluate('document.getElementById("form-status").textContent.includes("Boundary returned")'),'boundary returned to form');
  assert.equal(await evaluate('mappingData.area_sqm>0'),true);popupSocket.close();assert.equal(errors.length,0,errors.join('\n'));
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/farmers.html'});
  await waitFor(()=>evaluate('document.getElementById("owner_id")?.options.length>1'),'profile account options');
  assert.equal(await evaluate('document.getElementById("farmer-form-dialog").open'),false);
  await evaluate('document.getElementById("open-farmer-form").click()');
  assert.equal(await evaluate('document.getElementById("farmer-form-dialog").open'),true);
  await evaluate('document.getElementById("first_name").value="Retained draft";document.getElementById("close-farmer-form").click();document.getElementById("open-farmer-form").click()');
  assert.equal(await evaluate('document.getElementById("first_name").value'),'Retained draft');
  for(const width of [1280,390,320]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<850});await pause(150);
    assert.equal(await evaluate('(()=>{const d=document.getElementById("farmer-form-dialog");return d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().right<=innerWidth})()'),true,'Profile modal overflow '+width);
  }
  await evaluate('document.getElementById("close-farmer-form").click()');
  tables.farmers=[{id:'33333333-3333-4333-8333-333333333333',owner_id:owner,first_name:'Existing',last_name:'Farmer',full_name:'Existing Farmer',registration_status:'approved',created_at:'2026-01-01',updated_at:'2026-01-01'}];
  await evaluate('document.getElementById("refresh-records").click()');
  await waitFor(()=>evaluate('document.getElementById("records-body").textContent.includes("Existing Farmer")'),'existing profile refreshed');
  await evaluate('document.getElementById("open-farmer-form").click()');
  assert.equal(await evaluate('document.getElementById("first_name").value'),'Existing','Profile button must load the saved profile');
  assert.equal(await evaluate('document.getElementById("form-heading").textContent'),'Edit record');
  await evaluate('document.getElementById("first_name").value="Unsaved change";document.getElementById("close-farmer-form").click();document.getElementById("open-farmer-form").click()');
  assert.equal(await evaluate('document.getElementById("first_name").value'),'Unsaved change');
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS farmer modals, retained drafts, responsive form layout and mapping round trip.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(send)await Promise.race([send('Browser.close').catch(()=>{}),pause(1000)]);debugSocket?.close();browser?.kill();server?.closeAllConnections();server?.close();});
