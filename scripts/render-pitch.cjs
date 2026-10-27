const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));let browser,socket,send;
(async()=>{
 const out=path.resolve('docs/pitch'),dir=path.join(out,'slides');fs.mkdirSync(dir,{recursive:true});
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'caaps-pitch-'));
 browser=spawn(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless','--no-sandbox','--disable-gpu','--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let port;for(let i=0;i<200;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];if(/^\d+$/.test(port))break;}catch{}await pause(100);}if(!port)throw Error('Chrome debugger unavailable');
 const target=await(await fetch('http://127.0.0.1:'+port+'/json/new?about:blank',{method:'PUT'})).json();socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
 let id=0;const pending=new Map();socket.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const item=pending.get(m.id);pending.delete(m.id);clearTimeout(item.timer);m.error?item.reject(m.error):item.resolve(m.result);}};
 send=(method,params={})=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error('Timeout '+method)),30000);pending.set(key,{resolve,reject,timer});socket.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result?.value;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1280,height:720,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'file:///'+path.join(out,'Pitch-Preview.html').replaceAll('\\','/')});
 for(let i=0;i<100;i++){if(await evaluate('document.readyState==="complete"&&document.querySelectorAll(".slide").length===11'))break;await pause(100);}await evaluate('document.fonts.ready.then(()=>true)');
 const overflow=await evaluate('[...document.querySelectorAll(".slide>div")].filter(el=>el.textContent&&el.scrollHeight>el.clientHeight+2).map(el=>({text:el.textContent,height:el.clientHeight,scroll:el.scrollHeight}))');
 if(overflow.length)throw Error('Pitch text overflow: '+JSON.stringify(overflow));
 const pdf=await send('Page.printToPDF',{printBackground:true,displayHeaderFooter:false,preferCSSPageSize:true,paperWidth:13.333333,paperHeight:7.5,marginTop:0,marginBottom:0,marginLeft:0,marginRight:0});fs.writeFileSync(path.join(out,'CaAPs-Research-Learning-Pitch.pdf'),Buffer.from(pdf.data,'base64'));
 for(let i=0;i<11;i++){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:i*720,width:1280,height:720,scale:1}});fs.writeFileSync(path.join(dir,'slide-'+String(i+1).padStart(2,'0')+'.png'),Buffer.from(shot.data,'base64'));}
 console.log('Rendered 11 slide previews and PDF; no text-container overflow detected.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{if(send)await Promise.race([send('Browser.close').catch(()=>{}),pause(1000)]);socket?.close();browser?.kill();});
