// Real-browser integration with isolated test fixtures, never operational data.
// Run: node tests/browser-field.cjs (Chrome required; optional CHROME_PATH).
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
  const loaded=new Promise(resolve=>events.set('Page.loadEventFired',resolve));
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/harvests.html'});await loaded;
  await waitFor(()=>evaluate('document.getElementById("plantation_id").options.length===2'),'harvest form initialization');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await evaluate('document.getElementById("nav-toggle").click()');
  assert.equal(await evaluate('document.getElementById("nav-toggle").getAttribute("aria-expanded")'),'true');
  await evaluate('document.getElementById("nav-toggle").click()');
  await evaluate('CacaoSync.unlock("a browser integration passphrase")');
  await evaluate('Promise.all(["plantations","harvests"].map(async table=>CacaoSync.cache(table,await listAll(table))))');
  await waitFor(()=>evaluate('!!navigator.serviceWorker.controller'),'public offline shell activation');
  await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await evaluate('(()=>{const form=document.getElementById("monitor-form");form.elements.plantation_id.value="22222222-2222-4222-8222-222222222222";form.elements.harvest_date.value="2026-01-05";form.elements.wet_bean_kg.value="50";form.elements.dry_bean_kg.value="20";form.requestSubmit();})()');
  await waitFor(()=>evaluate('CacaoSync.envelopes().then(rows=>rows.length===1&&rows[0].status==="pending")'),'encrypted offline enqueue');
  assert.equal(rpcCalls,0);
  const reloaded=new Promise(resolve=>events.set('Page.loadEventFired',resolve));await send('Page.reload');await reloaded;
  await waitFor(()=>evaluate('!!document.getElementById("field-unlock-dialog")?.open'),'recovery unlock dialog after offline reload');
  await evaluate('document.getElementById("field-passphrase").value="a browser integration passphrase";document.getElementById("field-unlock-form").requestSubmit()');
  await waitFor(()=>evaluate('CacaoSync.unlocked()&&document.getElementById("plantation_id").options.length===2'),'offline form recovery');
  assert.equal(await evaluate('CacaoSync.envelopes().then(rows=>rows[0].status)'),'pending');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await waitFor(()=>evaluate('CacaoSync.envelopes().then(rows=>rows[0].status==="synced")'),'automatic retry and confirmed receipt',20000);
  assert.equal(tables.harvests.length,1);assert.equal(receipts.size,1);assert(rpcCalls>=2);
  await waitFor(()=>evaluate('document.getElementById("monitor-count").textContent.startsWith("1 records")'),'confirmed harvest appears in history');
  assert.equal(errors.length,0,errors.join('\n'));
  const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});const screenshotPath=path.join(os.tmpdir(),'cacao-field-sync-mobile.png');fs.writeFileSync(screenshotPath,Buffer.from(screenshot.data,'base64'));
  console.log('PASS browser: mobile navigation, real IndexedDB encryption, offline reload/unlock, reconnect retry and lost-confirmation recovery without a duplicate fixture record.');
  console.log('Screenshot: '+screenshotPath);
  const dashboardLoaded=new Promise(resolve=>events.set('Page.loadEventFired',resolve));
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/farmer/farmer.html'});await dashboardLoaded;
  await waitFor(()=>evaluate('document.getElementById("stat-farms").textContent==="1"'),'dashboard records');
  assert.equal(await evaluate('document.querySelectorAll(".mobile-shortcut").length'),6);
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-dock")).display'),'flex');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await evaluate('document.querySelector(".mobile-dock button").click()');
  assert.equal(await evaluate('document.getElementById("workspace-nav").classList.contains("nav-open")'),true);
  await evaluate('document.querySelector(".mobile-nav-shade").click()');
  assert.equal(await evaluate('document.querySelector(".mobile-dock button").getAttribute("aria-expanded")'),'false');
  const mobileScreenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(os.tmpdir(),'cacao-mobile-dashboard.png'),Buffer.from(mobileScreenshot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-dock")).display'),'none');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".mobile-shortcuts")).display'),'none');
  console.log('PASS responsive dashboard: six shortcuts, bottom navigation, menu/backdrop, 320px width and desktop visibility.');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  const publicLoaded=new Promise(resolve=>events.set('Page.loadEventFired',resolve));
  await send('Page.navigate',{url:'http://127.0.0.1:'+port+'/index.html'});await publicLoaded;
  await waitFor(()=>evaluate('document.querySelectorAll(".public-mobile-action").length===6'),'public mobile shortcuts');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".public-mobile-dock")).display'),'flex');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  await evaluate('document.querySelector(".public-mobile-toggle").click()');
  assert.equal(await evaluate('document.querySelector(".public-mobile-toggle").getAttribute("aria-expanded")'),'true');
  await evaluate('document.querySelector(".public-mobile-toggle").click()');
  const publicScreenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  fs.writeFileSync(path.join(os.tmpdir(),'cacao-public-mobile.png'),Buffer.from(publicScreenshot.data,'base64'));
  await send('Emulation.setDeviceMetricsOverride',{width:320,height:740,deviceScaleFactor:1,mobile:true});
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth+1'),true);
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS public mobile homepage: six shortcut cards, bottom navigation, collapsible menu and no overflow at 320/390px.');
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  if(send)await Promise.race([send('Browser.close').catch(()=>{}),pause(1000)]);
  if(debugSocket)debugSocket.close();
  if(browser)browser.kill();
  if(server)server.closeAllConnections();
  if(server)server.close();
});
