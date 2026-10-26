const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(configured=true){
  const scripts=[];
  const context=vm.createContext({configured,URL,setTimeout,clearTimeout,location:{href:'https://cacao.example/login.html'},document:{currentScript:{src:'https://cacao.example/assets/js/db.js'},head:{append:script=>scripts.push(script)},createElement:()=>({remove(){}})},window:{CACAO_SUPABASE_URL:'https://example.supabase.co',CACAO_SUPABASE_KEY:'public-test-key'}});
  vm.runInContext(fs.readFileSync('assets/js/db.js','utf8'),context);
  return {context,scripts};
}
test('missing SDK recovers from the same-origin vendor library with one shared request',async()=>{
  const {context,scripts}=setup();const first=context.ensureDatabaseClient(),second=context.ensureDatabaseClient();
  assert.equal(scripts.length,1);assert.equal(scripts[0].src,'https://cacao.example/assets/vendor/supabase/supabase.min.js?retry=1');
  const client={auth:{}};context.window.supabase={createClient:()=>client};scripts[0].onload();
  assert.equal(await first,client);assert.equal(await second,client);assert.equal(await context.ensureDatabaseClient(),client);assert.equal(scripts.length,1);
});
test('SDK download failure explains the deployment problem and permits a retry',async()=>{
  const {context,scripts}=setup();const first=context.ensureDatabaseClient();scripts[0].onerror();await assert.rejects(first,/login library is unavailable.*deployment/);
  const retry=context.ensureDatabaseClient();assert.equal(scripts.length,2);context.window.supabase={createClient:()=>({auth:{}})};scripts[1].onload();await retry;
});
test('invalid configuration is reported before loading the SDK',async()=>{
  const {context,scripts}=setup(false);await assert.rejects(context.ensureDatabaseClient(),/configuration is missing or invalid/);assert.equal(scripts.length,0);
});
test('deployment excludes backend Supabase without excluding the browser SDK',()=>{
  const rules=fs.readFileSync('.vercelignore','utf8').split(/\r?\n/);assert(rules.includes('/supabase/'));assert(!rules.includes('supabase'));assert(rules.includes('!assets/vendor/supabase/supabase.min.js'));
  const context=vm.createContext({URL,TextEncoder,TextDecoder,fetch,console});context.window=context;
  vm.runInContext(fs.readFileSync('assets/vendor/supabase/supabase.min.js','utf8'),context);assert.equal(typeof context.supabase.createClient,'function');
});
