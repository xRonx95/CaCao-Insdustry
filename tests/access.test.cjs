const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({window:{}});vm.runInContext(fs.readFileSync('assets/js/access.js','utf8'),context);const message=context.window.CacaoAccess.message;
test('access guidance distinguishes assignments from an absence of farmer data',()=>{
 assert.match(message('admin',0),/all farmer records/);assert.match(message('admin',0),/not required/);
 assert.match(message('field',0),/No farmer accounts are assigned/);assert.match(message('field',2),/2 farmer accounts/);assert.equal(message('admin',0),message('admin',2));assert.match(message('farmer',null),/only your own/);assert.match(message('super_admin',null),/Users & access/);
});
