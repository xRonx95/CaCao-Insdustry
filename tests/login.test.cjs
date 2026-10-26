const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup({error=null,profileError=null,online=true,auth,persist=true,search=''}={}) {
  const elements=Object.fromEntries(['login-form','auth-status','submit-auth','email','password'].map(id=>[id,{value:'',handlers:{},setAttribute(k,v){this[k]=v;},addEventListener(k,fn){this.handlers[k]=fn;}}]));
  elements.email.value='farmer@example.com';elements.password.value='example-password';
  const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const redirects=[],calls=[];let session=null;
  const context=vm.createContext({URLSearchParams,document:{getElementById:id=>elements[id]},configured:true,navigator:{onLine:online},sessionStorage:storage,localStorage:storage,location:{search,replace:url=>redirects.push(url)},connectionFailure:e=>/fetch|network/i.test(e?.message||''),savedOfflineAccount:()=>null,rememberVerifiedAccount(){},roleHome:role=>role+'/'+role+'.html',accountAccess:async()=>{if(profileError)throw profileError;return {profile:{role:'farmer'}};},db:{auth:{getSession:async()=>({data:{session}}),signInWithPassword:async values=>{calls.push(values);const response=await (auth?auth():{data:{session:{user:{id:'farmer'}}},error});if(persist&&!response.error)session=response.data.session;return response;}}}});
  vm.runInContext(fs.readFileSync('assets/js/login.js','utf8'),context);
  return {elements,calls,redirects,values,context,submit:()=>elements['login-form'].handlers.submit({preventDefault(){}})};
}
test('successful login redirects without a timer and carries success feedback to the workspace',async()=>{
  const s=setup();await s.submit();assert.equal(s.redirects[0],'farmer/farmer.html');assert.match(s.elements['auth-status'].textContent,/Login successful/);assert.equal(s.values.get('cacao-login-success'),'1');
});
test('incorrect credentials explain uncertainty and keep sign-in available',async()=>{
  const s=setup({error:{code:'invalid_credentials'}});await s.submit();assert.match(s.elements['auth-status'].textContent,/email or password is incorrect/);assert.equal(s.redirects.length,0);assert.equal(s.elements['submit-auth'].disabled,false);assert.equal(s.elements['auth-status'].role,'alert');
});
test('unverified email, rate limits, timeout and suspended account each explain the failure',async()=>{
  for(const [error,expected]of [[{code:'email_not_confirmed'},/not been verified/],[{status:429},/Too many login attempts/],[{name:'TimeoutError'},/too long/],[{code:'user_banned'},/suspended/]]){const s=setup({error});await s.submit();assert.match(s.elements['auth-status'].textContent,expected);assert.equal(s.redirects.length,0);}
});
test('profile rejection after authentication never shows login success',async()=>{
  const s=setup({profileError:Error('This account is suspended.')});await s.submit();assert.equal(s.redirects.length,0);assert.match(s.elements['auth-status'].textContent,/suspended/);assert(!s.values.has('cacao-login-success'));
});
test('offline and invalid email submissions do not contact authentication',async()=>{
  const s=setup({online:false});await s.submit();assert.equal(s.calls.length,0);assert.match(s.elements['auth-status'].textContent,/Connect/);
  const invalid=setup();invalid.elements.email.value='invalid';await invalid.submit();assert.equal(invalid.calls.length,0);assert.match(invalid.elements['auth-status'].textContent,/valid email/);
});
test('double submission makes only one authentication request',async()=>{
  let finish;const s=setup({auth:()=>new Promise(resolve=>finish=resolve)});const pending=s.submit();await s.submit();assert.equal(s.calls.length,1);finish({data:{session:{user:{id:'farmer'}}}});await pending;
});
test('missing persisted session stays on login with an explanation instead of bouncing to the dashboard',async()=>{
  const s=setup({persist:false});await s.submit();assert.equal(s.redirects.length,0);assert.match(s.elements['auth-status'].textContent,/session was not saved/);assert(!s.values.has('cacao-login-success'));
});
test('dashboard session failure explains the return and prevents automatic redirect loops',async()=>{
  const s=setup({search:'?reason=session_missing'});await Promise.resolve();assert.match(s.elements['auth-status'].textContent,/could not restore/);assert.equal(s.redirects.length,0);await s.submit();assert.equal(s.redirects[0],'farmer/farmer.html');
});
test('blocked browser storage prevents authentication and explains how to proceed',async()=>{
  const s=setup();s.context.localStorage={setItem(){throw Error('Storage blocked');}};await s.submit();assert.equal(s.calls.length,0);assert.match(s.elements['auth-status'].textContent,/browser cannot save/);
});
