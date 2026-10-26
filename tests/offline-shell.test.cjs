const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function shell() {
  const listeners = {}, stored = new Map(), puts = [];
  const cache = {
    match: async key => stored.get(typeof key === 'string' ? key : key.url),
    put: async (key, response) => puts.push([key, response])
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../service-worker.js'), 'utf8'), {
    URL, AbortSignal,
    self: { location: { href: 'https://cacao.example/service-worker.js' }, navigator: { onLine: false }, addEventListener: (name, fn) => listeners[name] = fn },
    caches: { open: async () => cache },
    fetch: async () => { throw new Error('offline'); }
  });
  return { listeners, stored, puts };
}
test('offline preparation fails clearly instead of hanging when opened directly as a file', async () => {
  const context = { URL, window: { isSecureContext: false }, document: { currentScript: null }, location: { href: 'file:///app/index.html', protocol: 'file:' }, navigator: { serviceWorker: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/offline.js'), 'utf8'), context);
  await assert.rejects(context.window.CacaoOffline.prepareLibraries(), /HTTPS or localhost/);
});
test('offline shell restores parameterized private-page shells without caching private API data', async () => {
  const { listeners, stored, puts } = shell();
  const expected = { publicShell: true };
  stored.set('https://cacao.example/farmer/plantation-form.html', expected);
  let response;
  listeners.fetch({ request: { method: 'GET', url: 'https://cacao.example/farmer/plantation-form.html?id=private-record' }, respondWith: promise => response = promise });
  assert.equal(await response, expected);
  for (const url of [
    'https://project.supabase.co/rest/v1/farmers',
    'https://project.supabase.co/storage/v1/object/sign/farm-private/photo.png',
    'https://cacao.example/sql/007_safe_sync.sql',
    'https://cacao.example/.env',
    'https://tile.openstreetmap.org/1/1/1.png'
  ]) {
    listeners.fetch({ request: { method: 'GET', url }, respondWith: () => assert.fail('Must not intercept ' + url) });
  }
  assert.equal(puts.length, 0);
});
test('directory filters combine farmer search, barangay, farm status and review status', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/plantation-directory.js'), 'utf8'), context);
  const farm = { name: 'River Cacao', farmer_name: 'Ana Cruz', barangay: 'Tabuk', status: 'active', verification_status: 'pending' };
  assert.equal(context.window.CacaoDirectory.matches(farm, { search: ' ANA ', barangay: 'Tabuk', status: 'active', review: 'pending' }), true);
  assert.equal(context.window.CacaoDirectory.matches(farm, { search: 'Ana', review: 'verified' }), false);
  assert.equal(context.window.CacaoDirectory.matches(farm, { barangay: 'Other' }), false);
});

test('Android preparation uses bundled tools without requiring service workers', async () => {
  const context = { URL, window: { Capacitor: { isNativePlatform: () => true }, isSecureContext: true }, document: { currentScript: null }, location: { href: 'https://localhost/index.html', protocol: 'https:' }, navigator: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/js/offline.js'), 'utf8'), context);
  const result=await context.window.CacaoOffline.prepareLibraries();
  assert.equal(result.native,true);
  assert.equal(result.failed.length,0);
});

test('installation caches a small shell and explicit preparation downloads the rest with bounded concurrency',async()=>{
  const listeners={},installed=[];let active=0,peak=0,downloads=0;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8'),{
    URL,AbortSignal,self:{location:{href:'https://cacao.example/service-worker.js'},addEventListener:(name,fn)=>listeners[name]=fn,skipWaiting:async()=>{}},
    caches:{open:async()=>({addAll:async urls=>installed.push(...urls),put:async()=>{},match:async()=>null})},
    fetch:async()=>{active++;peak=Math.max(peak,active);downloads++;await Promise.resolve();active--;return {ok:true,clone:()=>({text:async()=>''})};}
  });
  let work;listeners.install({waitUntil:p=>work=p});await work;assert(installed.length<20);assert(!installed.some(url=>url.includes('/admin/')));
  let report;listeners.message({data:{type:'CACHE_LIBRARIES'},ports:[{postMessage:value=>report=value}],waitUntil:p=>work=p});await work;
  assert(downloads>200);assert(peak<=4);assert.equal(report.ready,true);
});

test('cache upgrades retain prepared public pages without copying private responses',async()=>{
  const listeners={},saved=new Map(),deleted=[];let claimed=false;
  const old=new Map([['https://cacao.example/farmer/plantation-form.html',{page:true}],['https://project.supabase.co/rest/v1/farmers',{private:true}]]);
  const current={match:async request=>saved.get(request.url),put:async(request,response)=>saved.set(request.url,response)};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8'),{
    URL,AbortSignal,self:{location:{href:'https://cacao.example/service-worker.js'},addEventListener:(name,fn)=>listeners[name]=fn,clients:{claim:async()=>{claimed=true;}}},
    caches:{keys:async()=>['cacao-shell-old'],open:async key=>key==='cacao-shell-old'?{keys:async()=>[...old.keys()].map(url=>({url})),match:async request=>old.get(request.url)}:current,delete:async key=>deleted.push(key)}
  });
  let work;listeners.activate({waitUntil:p=>work=p});await work;
  assert(saved.has('https://cacao.example/farmer/plantation-form.html'));assert.equal(saved.size,1);assert.deepEqual(deleted,['cacao-shell-old']);assert.equal(claimed,true);
});
