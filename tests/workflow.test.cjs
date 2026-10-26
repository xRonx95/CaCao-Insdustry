const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup({role='farmer', allowed=true, recordError=false}={}) {
  const elements = new Map();
  class Element {
    constructor(tag) { this.tag=tag; this.children=[]; }
    append(...children) { this.children.push(...children); }
    prepend(child) { this.children.unshift(child); }
    replaceChildren(...children) { this.children=children; }
    setAttribute() {}
    remove() {}
  }
  for (const id of ['page-content','plantation-workspace']) elements.set(id,new Element('div'));
  const calls=[], messages=[];
  const context=vm.createContext({window:{},document:{createElement:tag=>new Element(tag),getElementById:id=>elements.get(id)},currentAccount:{user:{id:'owner'},profile:{role}},URLSearchParams,location:{search:'?id=farm'},requireSession:async()=>allowed,getRecord:async(table,id)=>{calls.push([table,id]);if(recordError)throw Error('Access denied');return {id,name:'Farm A',verification_status:'pending'};},listAll:async()=>[],humanArea:()=> '1 ha',notify:(...args)=>messages.push(args),Intl,Date});
  vm.runInContext(fs.readFileSync('assets/js/workflow.js','utf8'),context);
  function flatten(el) { return [el,...el.children.flatMap(flatten)]; }
  return {api:context.window.CacaoWorkflow,calls,messages,content:elements.get('page-content'),workspace:elements.get('plantation-workspace'),flatten};
}
test('plantation workspace checks session before reading private data',async()=>{
  const s=setup({allowed:false});await s.api.workspace();assert.equal(s.calls.length,0);assert.equal(s.workspace.children.length,0);
});
test('plantation workspace reports denied records without showing farm content',async()=>{
  const s=setup({recordError:true});await s.api.workspace();assert.equal(s.workspace.children.length,0);assert.equal(s.messages[0][1],'Access denied');
});
test('farmer workspace scopes record links and excludes staff-only modules',async()=>{
  const s=setup();await s.api.workspace();const links=s.flatten(s.workspace).filter(n=>n.href).map(n=>n.href);
  assert(links.includes('harvests.html?plantation=farm'));assert(links.includes('trees.html?plantation=farm'));assert(!links.some(h=>/tasks|attendance|inspections/.test(h)));
});
test('staff workspace includes task and inspection links for the selected plantation',async()=>{
  const s=setup({role:'field'});await s.api.workspace();const links=s.flatten(s.workspace).filter(n=>n.href).map(n=>n.href);assert(links.includes('tasks.html?plantation=farm'));assert(links.includes('inspections.html?plantation=farm'));
});
test('farmer dashboard offers profile completion and no staff-only actions',async()=>{
  const s=setup();await s.api.dashboard({farmers:[],plantations:[]});const links=s.flatten(s.content).filter(n=>n.href).map(n=>n.href);assert(links.includes('farmers.html'));assert(links.includes('plantation-form.html'));assert(!links.includes('tasks.html'));assert(!links.includes('users.html'));
});
