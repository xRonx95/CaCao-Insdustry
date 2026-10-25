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
