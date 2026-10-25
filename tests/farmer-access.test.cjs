const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/session.js', 'utf8');

async function access(role, feature, offline = false, options = {}) {
  const redirects = [];
  let revealed = false;
  const account = { user: { id: 'test', email: 'test@example.com' }, profile: { role, account_status: 'active' } };
  const storage = { getItem: key => key === 'cacao-last-account' ? JSON.stringify({ account, verifiedAt: Date.now() - (options.age || 0) }) : null, setItem() {} };
  const context = vm.createContext({
    configured: true, navigator: { onLine: !offline }, sessionStorage: storage, localStorage: storage,
    document: { body: { dataset: { pageRole: role === 'super_admin' ? 'admin' : role, feature } },
      getElementById: id => ({ textContent: '', classList: { remove() { if (id === 'page-content') revealed = true; } }, addEventListener() {} }),
      querySelectorAll: () => [] },
    db: { auth: { getSession: async () => ({ data: { session: {user: {id: options.sessionUser || 'test'}} } }), onAuthStateChange() {} } },
    accountAccess: async () => { if (options.failure) throw options.failure; return account; }, roleHome: (role, prefix) => prefix + role + '/home.html',
    location: { replace: url => redirects.push(url) }, window: {}
  });
  const helpers = fs.readFileSync('assets/js/db.js', 'utf8');
  vm.runInContext(helpers.slice(helpers.indexOf('function connectionFailure'), helpers.indexOf('async function accountAccess')), context);
  vm.runInContext(source, context);
  const allowed = await vm.runInContext('requireSession()', context);
  return { allowed, revealed, redirects };
}

test('farmers cannot open staff features online or offline', async () => {
  for (const offline of [false, true]) for (const feature of ['workers','assignments','reports','audit','inspections','tasks','attendance','users']) {
    const result = await access('farmer', feature, offline);
    assert.equal(result.allowed, false, feature);
    assert.equal(result.revealed, false, feature);
    assert.equal(result.redirects.length, 1, feature);
  }
});
test('farm tools remain available and staff keep their features', async () => {
  for (const feature of ['dashboard','farmers','plantations','plantation-form','atlas','trees','posts','harvests','pests','sync']) assert.equal((await access('farmer', feature)).allowed, true, feature);
  for (const role of ['admin','super_admin','field']) assert.equal((await access(role, 'workers')).allowed, true, role);
});
test('farmer menus omit staff features on every page', () => {
  for (const file of fs.readdirSync('farmer').filter(file => file.endsWith('.html'))) {
    const html = fs.readFileSync('farmer/' + file, 'utf8');
    assert.doesNotMatch(html, /href="(?:workers|assignments|reports|audit|inspections|tasks|attendance)\.html"/, file);
  }
});

test('connection failure uses verified offline identity only for farmers', async () => {
  for (const role of ['farmer']) {
    const result = await access(role, 'plantations', false, {failure: {name:'AuthRetryableFetchError',message:'Failed to fetch'}});
    assert.equal(result.allowed, true);
    assert.equal(result.revealed, true);
    assert.equal(result.redirects.length, 0);
  }
});
test('offline fallback rejects expired metadata, different accounts and real auth denials', async () => {
  await assert.rejects(access('farmer', 'dashboard', true, {age:25*60*60*1000}), /Connect and verify/);
  await assert.rejects(access('farmer', 'dashboard', false, {sessionUser:'other',failure:{name:'AuthRetryableFetchError'}}), /Connect and verify/);
  for (const message of ['Your session has expired. Please log in.', 'This account is suspended.']) {
    await assert.rejects(access('farmer', 'dashboard', false, {failure:new Error(message)}), error => error.message === message);
  }
});

test('staff cannot use offline work and farmers are routed to mapping tools', async () => {
  for (const role of ['admin','super_admin','field']) await assert.rejects(access(role, 'dashboard', true), /only to farmers/);
  const result=await access('farmer','dashboard',true);
  assert.equal(result.allowed,false);
  assert.equal(result.redirects[0],'../farmer/plantations.html');
  for(const feature of ['plantations','plantation-form','atlas','trees','sync']) assert.equal((await access('farmer',feature,true)).allowed,true,feature);
});

test('farmer plantation tools share an accessible dropdown with local icons', () => {
  for (const file of fs.readdirSync('farmer').filter(file => file.endsWith('.html') && file !== 'mapping.html')) {
    const html=fs.readFileSync('farmer/'+file,'utf8');
    const group=html.match(/<details class="nav-group"[^>]*>[\s\S]*?<\/details>/)?.[0];
    assert(group,file);
    assert.match(group,/<summary>/,file);
    for(const href of ['plantations.html','plantation-form.html','atlas.html','trees.html']) assert(group.includes('href="'+href+'"'),file+' '+href);
    assert.match(group,/data-local-icon=/,file);
    assert.equal((html.match(/class="nav-group"/g)||[]).length,3,file);
  }
});
