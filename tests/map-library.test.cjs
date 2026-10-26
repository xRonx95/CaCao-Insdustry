const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function library(){const context=vm.createContext({window:{}},{codeGeneration:{strings:false,wasm:false}});vm.runInContext(fs.readFileSync('assets/vendor/turf/turf.min.js','utf8'),context);vm.runInContext(fs.readFileSync('assets/js/record-integrity.js','utf8'),context);return context;}
const polygon={type:'Polygon',coordinates:[[[121.97,6.7],[121.971,6.7],[121.971,6.701],[121.97,6.7]]]};
test('bundled geometry library draws and validates boundaries without unsafe-eval',()=>{
  const {turf}=library();const feature=turf.polygon(polygon.coordinates);assert(turf.area(feature)>0);assert.equal(turf.kinks(feature).features.length,0);
});
test('overlap checks use the pinned library feature-collection interface',()=>{
  const context=library();assert(context.window.CacaoIntegrity.overlapArea(polygon,polygon)>0);
});
