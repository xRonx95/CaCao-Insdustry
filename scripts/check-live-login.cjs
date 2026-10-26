// Read-only page diagnostics plus one synthetic invalid-credentials submission.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let browser,socket;
(async()=>{
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cacao-login-diagnostic-'));
  browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;!fs.existsSync(portFile)&&i<150;i++)await pause(100);
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();
  socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
  let id=0;const pending=new Map(),errors=[],failures=[];
  socket.onmessage=({data})=>{const message=JSON.parse(data);if(message.id){const item=pending.get(message.id);pending.delete(message.id);message.error?item.reject(message.error):item.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);else if(message.method==='Network.loadingFailed')failures.push(message.params.errorText);};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const next=++id;pending.set(next,{resolve,reject});socket.send(JSON.stringify({id:next,method,params}));});
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable');
  await send('Page.navigate',{url:'https://cacao-insdustry.vercel.app/login.html'});
  for(let i=0;i<100;i++){if(await evaluate('document.readyState==="complete"'))break;await pause(200);}
  console.log('Initial state:',JSON.stringify(await evaluate('({url:location.href,status:document.getElementById("auth-status")?.textContent,disabled:document.getElementById("submit-auth")?.disabled,sdk:typeof window.supabase?.createClient,client:typeof db!=="undefined"&&!!db})')));
  await evaluate('document.getElementById("email").value="diagnostic@example.invalid";document.getElementById("password").value="invalid-diagnostic-password";document.getElementById("submit-auth").click()');
  await pause(5000);
  console.log('After invalid login:',JSON.stringify(await evaluate('({url:location.href,status:document.getElementById("auth-status")?.textContent,disabled:document.getElementById("submit-auth")?.disabled})')));
  console.log('Runtime errors:',JSON.stringify(errors));console.log('Network failures:',JSON.stringify(failures));
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>{socket?.close();browser?.kill();});
setTimeout(()=>{socket?.close();browser?.kill();process.exit(1);},35000).unref();
