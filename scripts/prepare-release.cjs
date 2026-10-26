// Publish only public application files and fingerprint resource references.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),output=path.resolve(root,'dist');
if(output!==path.join(root,'dist')||!output.startsWith(root+path.sep))throw new Error('Invalid release output directory');
if(fs.existsSync(output)){
  if(fs.lstatSync(output).isSymbolicLink()||fs.realpathSync(output)!==output)throw new Error('Release output must be a normal workspace directory');
  fs.rmSync(output,{recursive:true});
}
fs.mkdirSync(output);
for(const folder of ['assets','images','admin','farmer','field','downloads'])if(fs.existsSync(path.join(root,folder)))fs.cpSync(path.join(root,folder),path.join(output,folder),{recursive:true});
for(const file of fs.readdirSync(root).filter(file=>file.endsWith('.html')||['favicon.ico','manifest.webmanifest'].includes(file)))fs.copyFileSync(path.join(root,file),path.join(output,file));
function fingerprint(html,directory){return html.replace(/\b(src|href)="([^"?#]+)(?:\?[^"#]*)?"/g,(whole,attribute,reference)=>{
  if(/^(?:https?:|data:|#)/.test(reference)||! /\.(?:js|css|png|ico|webmanifest)$/.test(reference))return whole;
  const file=path.resolve(directory,reference);
  if(!file.startsWith(output+path.sep)||!fs.existsSync(file))return whole;
  const hash=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12);
  return attribute+'="'+reference+'?v='+hash+'"';
});}
for(const directory of [output,...['admin','farmer','field'].map(folder=>path.join(output,folder))])for(const file of fs.readdirSync(directory).filter(file=>file.endsWith('.html'))){const target=path.join(directory,file);const html=fingerprint(fs.readFileSync(target,'utf8'),directory).replace(/\b(href|src)="([^":?#]+)\.html([?#][^"]*)?"/g,(_,attribute,reference,suffix)=>attribute+'="'+reference+(suffix||'')+'"');fs.writeFileSync(target,html);}
execFileSync(process.execPath,[path.join(__dirname,'rebuild-offline-cache.cjs'),output],{stdio:'inherit'});
console.log('Public release prepared in dist with versioned styles, scripts and images.');
