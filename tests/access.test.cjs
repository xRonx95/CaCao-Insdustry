const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('assets/js/access.js','utf8'),context);const message=context.window.CacaoAccess.message;
test('access guidance distinguishes assignments from an absence of farmer data',()=>{
 assert.match(message('admin',0),/No farmer accounts are assigned/);assert.match(message('admin',0),/super administrator/);
 assert.match(message('admin',2),/2 farmer accounts/);assert.match(message('farmer',null),/only your own/);assert.match(message('super_admin',null),/Users & access/);
});
