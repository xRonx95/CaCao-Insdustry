// Execute the actual TypeScript handler with isolated SDK/env fixtures; no emails are sent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/invite-team/index.ts'), 'utf8');
function fixture(options = {}) {
  let handler;
  const calls = [];
  const env = { ALLOWED_ORIGIN: 'https://cacao.example', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'server-only', ...options.env };
  const client = {
    auth: { getUser: async () => ({ data: { user: options.invalidSession ? null : { id: 'operator' } }, error: null }) },
    from: () => ({ select() { return this; }, eq() { return this; }, single: async () => ({
      data: { role: options.role || 'super_admin', account_status: options.suspended ? 'suspended' : 'active' }, error: null
    }) }),
    rpc: async (name, body) => { calls.push({ rpc: name, body }); return { error: options.roleError ? { message: 'fixture error' } : null }; }
  };
  const service = {
    auth: { admin: { inviteUserByEmail: async (email, body) => {
      calls.push({ invite: email, body });
      return { data: options.emptyInvitation ? {} : { user: { id: 'invited-user' } }, error: null };
    } } }
  };
  const code = stripTypeScriptTypes(source.replace(/^import .*;\r?$/m, ''), { mode: 'strip' });
  vm.runInNewContext(code, {
    Request, Response, URL,
    Deno: { env: { get: name => env[name] }, serve: value => handler = value },
    createClient: (_url, key) => key === 'server-only' ? service : client
  });
  const body = { email: 'staff@example.invalid', role: 'field', redirectTo: 'https://cacao.example/reset-password.html' };
  const request = (overrides = {}) => {
    const { method = 'POST', origin = env.ALLOWED_ORIGIN, authorization = 'Bearer fixture-session', data = body } = overrides;
    const headers = { Origin: origin, Authorization: authorization };
    return handler(new Request('https://fixture.supabase.co/functions/v1/invite-team', {
      method, headers, ...(method === 'POST' ? { body: typeof data === 'string' ? data : JSON.stringify(data) } : {})
    }));
  };
  return { request, calls, body };
}
test('invitation handler rejects untrusted origins and permits preflight without a session', async () => {
  const f = fixture();
  assert.equal((await f.request({ origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await f.request({ method: 'OPTIONS', authorization: '' })).status, 204);
  assert.equal(f.calls.length, 0);
});
test('invitation handler requires an active super administrator', async () => {
  for (const options of [{ role: 'farmer' }, { role: 'admin' }, { suspended: true }, { invalidSession: true }]) {
    const f = fixture(options);
    assert.equal((await f.request()).status, options.invalidSession ? 401 : 403);
    assert.equal(f.calls.length, 0);
  }
  assert.equal((await fixture().request({ authorization: 'Bearer ' })).status, 401);
});
test('invitation handler validates JSON, roles and redirect before sending an invitation', async () => {
  const f = fixture();
  for (const data of ['{broken', null, [], { ...f.body, role: 'super_admin' }, { ...f.body, redirectTo: undefined }, { ...f.body, redirectTo: 'https://elsewhere.example/reset-password.html' }]) {
    assert.equal((await f.request({ data })).status, 400);
  }
  assert.equal(f.calls.length, 0);
});
test('invitation handler reports missing server configuration without exposing secrets', async () => {
  const f = fixture({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  const response = await f.request();
  assert.equal(response.status, 500);
  assert.equal(f.calls.length, 0);
  assert(!JSON.stringify(await response.json()).includes('server-only'));
});
test('invitation handler detects empty invitation responses and partial role assignment failure', async () => {
  const missing = fixture({ emptyInvitation: true });
  assert.equal((await missing.request()).status, 502);
  assert.equal(missing.calls.length, 1);
  const partial = fixture({ roleError: true });
  const response = await partial.request();
  assert.equal(response.status, 500);
  assert.match((await response.json()).error, /Invitation sent, but role assignment failed/);
});
test('invitation handler assigns only the requested staff role after a successful invite', async () => {
  const f = fixture();
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.equal(f.calls[0].invite, 'staff@example.invalid');
  assert.equal(f.calls[1].rpc, 'set_account_access');
  assert.equal(f.calls[1].body.target, 'invited-user');
  assert.equal(f.calls[1].body.new_role, 'field');
});
