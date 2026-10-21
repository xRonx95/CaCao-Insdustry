const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto').webcrypto;
function database(){
  const stores=new Map();let initialized=false;
  return {stores,api:{open(){const request={};queueMicrotask(()=>{
    request.result={createObjectStore(name){stores.set(name,new Map());},close(){},transaction(name){const tx={};tx.objectStore=()=>({
      get(id){queueMicrotask(()=>tx.oncomplete?.());return {result:stores.get(name).get(id)};},
      getAll(){queueMicrotask(()=>tx.oncomplete?.());return {result:[...stores.get(name).values()].map(row=>structuredClone(row))};},
      put(row){stores.get(name).set(row.id,structuredClone(row));queueMicrotask(()=>tx.oncomplete?.());return {result:row.id};},
      delete(id){stores.get(name).delete(id);queueMicrotask(()=>tx.oncomplete?.());return {result:undefined};}
    });return tx;}};
    if(!initialized){request.onupgradeneeded();initialized=true;}request.onsuccess();
  });return request;}}};
}
function context(storage,rpc,online=false){
  const account={user:{id:'actor-a'},profile:{role:'farmer'}};
  const browser={dispatchEvent(){},addEventListener(){}};
  const values={window:browser,document:{getElementById:()=>null},currentAccount:account,navigator:{onLine:online},crypto,TextEncoder,TextDecoder,indexedDB:storage.api,CustomEvent:class{},setTimeout:()=>1,clearTimeout(){},db:{rpc},accountAccess:async()=>account};
  const ctx=vm.createContext(values);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/sync.js'),'utf8'),ctx);return {sync:ctx.window.CacaoSync,ctx};
}
const change={changeId:'change-one',entity:'farmers',recordId:'farmer-one',payload:{owner_id:'actor-a',first_name:'Private',last_name:'Farmer',full_name:'Private Farmer'}};
test('offline submissions are encrypted, survive reload, and synchronize only after unlock',async()=>{
  const store=database();let calls=0;
  const rpc=async(name,body)=>{calls++;return {data:{confirmed:true,record:{...body.payload,id:body.record_id,updated_at:'2026-10-21T00:00:00Z'}},error:null};};
  let {sync}=context(store,rpc);await sync.unlock('a protected field passphrase');
  assert.equal((await sync.submit(change)).status,'queued');assert.equal(calls,0);
  const envelope=store.stores.get('queue').get('change-one');assert(envelope.encrypted instanceof ArrayBuffer);assert(!JSON.stringify(envelope).includes('Private Farmer'));
  ({sync}=context(store,rpc,true));assert.equal(sync.unlocked(),false);
  await assert.rejects(sync.unlock('an incorrect passphrase'),/Incorrect/);
  await sync.unlock('a protected field passphrase');
  for(let attempt=0;attempt<100&&(await sync.envelopes())[0].status!=='synced';attempt++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal((await sync.envelopes())[0].status,'synced');assert.equal(calls,1);
});
test('lost confirmation retries the same receipt key without duplicating server records',async()=>{
  const store=database(),receipts=new Map();let inserted=0,lost=true;
  const rpc=async(name,body)=>{
    if(!receipts.has(body.change_id)){inserted++;receipts.set(body.change_id,{...body.payload,id:body.record_id});}
    if(lost){lost=false;return {error:{message:'Failed to fetch'}};}
    return {data:{confirmed:true,replayed:true,record:receipts.get(body.change_id)},error:null};
  };
  const {sync,ctx}=context(store,rpc);await sync.unlock('a protected field passphrase');await sync.submit(change);
  ctx.navigator.onLine=true;await sync.retry();assert.equal((await sync.envelopes())[0].status,'pending');
  await sync.retry();assert.equal((await sync.envelopes())[0].status,'synced');assert.equal(inserted,1);
  await sync.clearConfirmed();assert.equal((await sync.envelopes()).length,0);
});
test('conflicts retain drafts and cannot be auto-overwritten or cleared as confirmations',async()=>{
  const store=database();const {sync,ctx}=context(store,async()=>({error:{code:'40001',message:'Revision conflict'}}));
  await sync.unlock('a protected field passphrase');await sync.submit({...change,entity:'plantations',revision:1});ctx.navigator.onLine=true;await sync.retry();
  assert.equal((await sync.envelopes())[0].status,'conflict');await sync.clearConfirmed();assert.equal((await sync.envelopes()).length,1);
  await assert.rejects(sync.revise('change-one',change.payload,null),/server/);
  await sync.archive('change-one');assert.equal((await sync.envelopes())[0].status,'archived');assert(store.stores.get('queue').get('change-one').encrypted);
});
test('queued outcomes cannot be replaced by a changed payload or another account',async()=>{
  const store=database();const {sync,ctx}=context(store,async()=>({}));await sync.unlock('a protected field passphrase');await sync.submit(change);
  await assert.rejects(sync.submit({...change,payload:{...change.payload,first_name:'Changed'}}),/unresolved outcome/);
  sync.lock();ctx.currentAccount={user:{id:'actor-b'},profile:{role:'farmer'}};await sync.unlock('a second field passphrase');
  assert.equal((await sync.envelopes()).length,0);await assert.rejects(sync.inspect('change-one'),/unavailable/);
});
