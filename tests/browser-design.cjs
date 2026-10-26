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
const receipts=new Map();let dropped=false,rpcCalls=0,server,send,browser,debugSocket;
function fixtures(){
  class Query{
    constructor(table){this.table=table;this.filters=[];this.from=0;this.to=9999;}
    select(){return this;}order(){return this;}limit(size){this.to=size-1;return this;}eq(key,value){this.filters.push([key,value]);return this;}
    range(from,to){this.from=from;this.to=to;return this;}
    async response(single=false){
      const data=await (await fetch('/__test_data?table='+encodeURIComponent(this.table))).json();
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
  await waitFor(()=>fs.existsSync(portFile),'Chrome debugger startup');
  const debugPort=fs.readFileSync(portFile,'utf8').split('\n')[0];
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
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  let shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'cacao-professional-desktop.png'),Buffer.from(shot.data,'base64'));
  for(const width of [850,390,320]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(250);assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true,'Mobile overflow '+width);assert.notEqual(await evaluate('getComputedStyle(document.getElementById("nav-toggle")).display'),'none','Mobile menu must be visible at '+width);assert.equal(await evaluate('document.querySelector("#nav-toggle svg").getBoundingClientRect().width>0'),true,'Menu icon must be visible');}
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'cacao-professional-mobile-overview.png'),Buffer.from(shot.data,'base64'));
  await evaluate('document.getElementById("nav-toggle").click()');assert.equal(await evaluate('document.getElementById("nav-toggle").getAttribute("aria-expanded")'),'true');
  shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(os.tmpdir(),'cacao-professional-mobile.png'),Buffer.from(shot.data,'base64'));
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS dashboard hierarchy, empty charts, desktop/mobile overflow, and menu behavior.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(send)await Promise.race([send('Browser.close').catch(()=>{}),pause(1000)]);debugSocket?.close();browser?.kill();server?.closeAllConnections();server?.close();});
