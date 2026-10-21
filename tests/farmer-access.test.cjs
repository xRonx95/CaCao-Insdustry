const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('assets/js/session.js', 'utf8');

async function access(role, feature, offline = false) {
  const redirects = [];
  let revealed = false;
  const account = { user: { id: 'test', email: 'test@example.com' }, profile: { role, account_status: 'active' } };
  const storage = { getItem: key => key === 'cacao-last-account' ? JSON.stringify({ account, verifiedAt: Date.now() }) : null, setItem() {} };
  const context = vm.createContext({
    configured: true, navigator: { onLine: !offline }, sessionStorage: storage, localStorage: storage,
    document: { body: { dataset: { pageRole: role === 'super_admin' ? 'admin' : role, feature } },
      getElementById: id => ({ textContent: '', classList: { remove() { if (id === 'page-content') revealed = true; } }, addEventListener() {} }),
      querySelectorAll: () => [] },
    db: { auth: { getSession: async () => ({ data: { session: {} } }), onAuthStateChange() {} } },
    accountAccess: async () => account, roleHome: (role, prefix) => prefix + role + '/home.html',
    location: { replace: url => redirects.push(url) }, window: {}
  });
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
