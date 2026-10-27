const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const run = (file, values) => {
  const context = vm.createContext(values);
  vm.runInContext(read(file), context, { filename: file });
  Object.assign(context, context.window || {});
  return context;
};

test('all pages have valid asset/navigation links and compatible classic scripts', () => {
  const pages = fs.readdirSync(root).filter(f => f.endsWith('.html'));
  for (const folder of ['admin','farmer','field']) {
    pages.push(...fs.readdirSync(path.join(root,folder)).filter(f=>f.endsWith('.html')).map(f=>folder+'/'+f));
  }
  for (const page of pages) {
    const html=read(page);
    const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size,ids.length,page+' duplicate IDs');
    const scripts=[];
    for (const match of html.matchAll(/(?:src|href)="([^"?#]+)"/g)) {
      if (/^(https?:|data:|#)/.test(match[1])) continue;
      assert(fs.existsSync(path.resolve(root,path.dirname(page),match[1])),page+' broken reference '+match[1]);
    }
    for(const match of html.matchAll(/<script defer src="([^"]+)"/g)){
      if(!match[1].startsWith('http'))scripts.push(fs.readFileSync(path.resolve(root,path.dirname(page),match[1]),'utf8'));
    }
    new vm.Script(scripts.join('\n'),{filename:page});
    assert(!/<style\b|\sstyle=/.test(html),page+' has inline styling');
    assert.equal((html.match(/rel="icon"/g)||[]).length,1,page+' favicon');
  }
});

function databaseContext({missing=false,status='active',role='farmer',profileError=null,noProfile=false}={}) {
  const calls=[];
  const query={
    select(){return this;},eq(key,value){calls.push([key,value]);return this;},
    update(value){calls.push(['update',value]);return this;},insert(value){calls.push(['insert',value]);return this;},
    async single(){return {data:noProfile?null:{role,account_status:status},error:profileError};},
    async maybeSingle(){return {data:missing?null:{id:'farm',revision:4},error:null};}
  };
  const client={auth:{getUser:async()=>({data:{user:{id:'user-a'}},error:null})},from:()=>query};
  const context=run('assets/js/db.js',{configured:true,window:{supabase:{createClient:()=>client}}});
  return {context,calls};
}
test('account access rejects suspended accounts and missing profile schema',async()=>{
  let {context}=databaseContext({status:'suspended'});
  await assert.rejects(vm.runInContext('accountAccess()',context),/suspended/);
  ({context}=databaseContext({profileError:{message:'missing account_status'}}));
  await assert.rejects(vm.runInContext('accountAccess()',context),/migrations/);
  ({context}=databaseContext({noProfile:true}));
  await assert.rejects(vm.runInContext('accountAccess()',context),/profile could not be found/);
});
test('roles redirect field and super admins to their correct dashboards',()=>{
  const {context}=databaseContext();
  assert.equal(vm.runInContext("roleHome('field')",context),'field/postharvest.html');
  assert.equal(vm.runInContext("roleHome('super_admin')",context),'admin/postharvest.html');
  assert.equal(vm.runInContext("accountRole({user_metadata:{role:'super_admin'}})",context),'farmer');
});
test('plantation updates preserve optimistic revisions and reject conflicts',async()=>{
  let {context,calls}=databaseContext();
  await vm.runInContext("savePlantation({id:'farm',revision:3,name:'New name'})",context);
  assert(calls.some(([key,value])=>key==='revision'&&value===3));
  const update=calls.find(([key])=>key==='update')[1];assert.equal(update.revision,undefined);
  ({context}=databaseContext({missing:true}));
  await assert.rejects(vm.runInContext("savePlantation({id:'farm',revision:1,name:'New name'})",context),/changed by another user/);
});
test('listAll retrieves records beyond Supabase default limits',async()=>{
  const ranges=[];
  const client={from:()=>({select(){return this;},order(){return this;},async range(from,to){ranges.push([from,to]);return {data:Array.from({length:from===0?500:3},(_,i)=>({id:from+i})),error:null};}})};
  const context=run('assets/js/db.js',{configured:true,window:{supabase:{createClient:()=>client}}});
  const rows=await vm.runInContext("listAll('plantations')",context);assert.equal(rows.length,503);assert.deepEqual(ranges,[[0,499],[500,999]]);
});
test('GPS rejects invalid positions and non-distinct/self-intersecting rings',()=>{
  const context=run('assets/js/gps-mapping.js',{window:{},document:{},turf:{polygon:ring=>({ring}),kinks:feature=>({features:feature.ring[0][1][0]===99?[{}]:[]}),area:()=>50}});
  assert.throws(()=>vm.runInContext('CacaoGPS.validatePosition({coords:{latitude:91,longitude:1,accuracy:1},timestamp:1})',context),/Invalid GPS/);
  assert.throws(()=>vm.runInContext('CacaoGPS.validatePosition({coords:{latitude:6,longitude:121,accuracy:-1},timestamp:1})',context),/Invalid GPS/);
  assert.throws(()=>vm.runInContext('CacaoGPS.validateRing([[0,0],[0,0],[0,0],[0,0]])',context),/distinct/);
  assert.throws(()=>vm.runInContext('CacaoGPS.validateRing([[0,0],[99,1],[1,0],[0,0]])',context),/crosses itself/);
  const valid=vm.runInContext('CacaoGPS.validatePosition({coords:{latitude:6.7,longitude:121.9,accuracy:8},timestamp:1234})',context);
  assert.equal(valid.accuracy,8);assert.equal(valid.timestamp,1234);
});
test('CSV exports neutralize spreadsheet formulas and quote values',()=>{
  const context=run('assets/js/platform.js',{window:{},document:{}});
  assert.equal(vm.runInContext(`CacaoApp.csvValue('=1+1')`,context),'"\'=1+1"');
  assert.equal(vm.runInContext(`CacaoApp.csvValue('a"b')`,context),'"a""b"');
});
test('encrypted drafts do not persist plaintext or passphrases and reject wrong keys',async()=>{
  const stored=new Map();
  const indexedDB={open(){
    const request={};
    queueMicrotask(()=>{request.result={close(){},transaction(){
      const tx={};
      tx.objectStore=()=>({put(value){stored.set(value.id,value);queueMicrotask(()=>tx.oncomplete());return {result:value.id};},get(id){queueMicrotask(()=>tx.oncomplete());return {result:stored.get(id)};},delete(id){stored.delete(id);queueMicrotask(()=>tx.oncomplete());return {result:undefined};}});
      return tx;
    }};request.onsuccess();});return request;
  }};
  const context=run('assets/js/drafts.js',{window:{},indexedDB,crypto,TextEncoder,TextDecoder});
  await vm.runInContext(`CacaoDrafts.save('draft-a',{farmer:'Private name',points:[1,2]},'a long test passphrase')`,context);
  const record=stored.get('draft-a');assert(record.encrypted instanceof ArrayBuffer);assert(!JSON.stringify(record).includes('Private name'));assert(!JSON.stringify(record).includes('passphrase'));
  const restored=await vm.runInContext(`CacaoDrafts.restore('draft-a','a long test passphrase')`,context);assert.equal(restored.farmer,'Private name');
  await assert.rejects(vm.runInContext(`CacaoDrafts.restore('draft-a','an incorrect passphrase')`,context),/incorrect/);
  await assert.rejects(vm.runInContext(`CacaoDrafts.save('draft-b',{},'short')`,context),/12 characters/);
});
