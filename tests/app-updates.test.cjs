const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('an installed update offers a reload without interrupting the current form',async()=>{
  const swEvents={},windowEvents={},elements=new Map();let reloads=0;
  function element(){return {children:[],handlers:{},setAttribute(){},append(...children){this.children.push(...children);for(const child of children)if(child.id)elements.set(child.id,child);},addEventListener(name,handler){this.handlers[name]=handler;},remove(){}};}
  const body=element(),registration={};
  const context=vm.createContext({URL,Date,CustomEvent:class{},confirm:()=>true,location:{href:'https://cacao.example/index.html',protocol:'https:',reload:()=>reloads++},navigator:{onLine:true,serviceWorker:{controller:{},register:async()=>registration,addEventListener:(name,handler)=>swEvents[name]=handler}},document:{currentScript:null,readyState:'complete',createElement:element,getElementById:id=>elements.get(id),body,addEventListener(){}},window:{isSecureContext:true,addEventListener:(name,handler)=>windowEvents[name]=handler,dispatchEvent(){}}});
  vm.runInContext(fs.readFileSync('assets/js/offline.js','utf8'),context);await context.window.CacaoOffline.register();
  swEvents.controllerchange();assert.equal(reloads,0);const notice=elements.get('app-update-notice');assert(notice);assert.match(notice.children[0].textContent,/Save or synchronize/);
  notice.children[1].handlers.click();assert.equal(reloads,1);
});
test('installation UI provides manual instructions when no native prompt is available',async()=>{
  const events={},status={},button={handlers:{},addEventListener:(name,handler)=>button.handlers[name]=handler};
  const context=vm.createContext({window:{matchMedia:()=>({matches:false}),addEventListener:(name,handler)=>events[name]=handler},navigator:{},document:{getElementById:()=>status,querySelectorAll:()=>[button]}});
  vm.runInContext(fs.readFileSync('assets/js/install-app.js','utf8'),context);await button.handlers.click();assert.match(status.textContent,/Add to Home screen/);events.appinstalled();assert.equal(button.disabled,true);assert.equal(button.textContent,'CaAPs is installed');
});
