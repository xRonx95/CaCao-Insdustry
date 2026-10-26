const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const context=vm.createContext({window:{}});
vm.runInContext(fs.readFileSync('assets/js/farmer-home.js','utf8'),context);
const model=context.window.CacaoFarmerHome.model;
test('farmer summary excludes other owners and unrelated plantation records',()=>{
 const summary=model({farmers:[{owner_id:'other'}],plantations:[{id:'mine',owner_id:'me'},{id:'other',owner_id:'other'}],harvests:[{owner_id:'me',plantation_id:'mine',harvest_date:'2026-01-02'},{owner_id:'other',plantation_id:'mine',harvest_date:'2026-10-20'},{owner_id:'me',plantation_id:'other',harvest_date:'2026-10-21'}]},'me','2026-10-27');
 assert.equal(summary.profiles.length,0);assert.equal(summary.farms.length,1);assert.equal(summary.latestHarvest.harvest_date,'2026-01-02');
 assert.equal(summary.progress.profile,false);assert.equal(summary.progress.approved,false);assert.equal(summary.progress.mapped,false);assert.equal(summary.progress.harvest,true);
});
test('reminders use the latest treatment for unresolved reports',()=>{
 const summary=model({farmers:[],plantations:[{id:'mine',owner_id:'me'}],reports:[{id:'open',owner_id:'me',plantation_id:'mine',resolution_status:'open'},{id:'done',owner_id:'me',plantation_id:'mine',resolution_status:'resolved'}],treatments:[{id:'a',owner_id:'me',plantation_id:'mine',pest_report_id:'open',treatment_date:'2026-01-01',next_inspection:'2026-01-05'},{id:'b',owner_id:'me',plantation_id:'mine',pest_report_id:'open',treatment_date:'2026-10-20',next_inspection:'2026-10-28'},{id:'c',owner_id:'me',plantation_id:'mine',pest_report_id:'done',treatment_date:'2026-10-20',next_inspection:'2026-10-21'}]},'me','2026-10-27');
 assert.equal(summary.reminders.length,1);assert.equal(summary.reminders[0].id,'b');assert.equal(summary.overdue,0);assert.equal(summary.openReports,1);
});
