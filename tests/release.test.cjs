const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('public release contains only deployable files and versioned local resources',()=>{
  const dist=path.join(root,'dist');assert(fs.existsSync(path.join(dist,'index.html')),'Run npm run build before these checks');
  for(const privatePath of ['sql','scripts','tests','supabase','.git','.env','www','README.md'])assert(!fs.existsSync(path.join(dist,privatePath)),privatePath+' must not be published');
  for(const folder of ['', 'admin','farmer','field'])for(const file of fs.readdirSync(path.join(dist,folder)).filter(f=>f.endsWith('.html'))){
    const html=fs.readFileSync(path.join(dist,folder,file),'utf8');assert(html.includes('rel="manifest"'),file+' needs manifest');
    for(const match of html.matchAll(/(?:src|href)="([^"?#]+)\?v=([a-f0-9]+)"/g)){
      const resource=path.resolve(dist,folder,match[1]);assert(resource.startsWith(dist+path.sep));const hash=crypto.createHash('sha256').update(fs.readFileSync(resource)).digest('hex').slice(0,12);assert.equal(match[2],hash,file+' resource version mismatch');
    }
    assert(/professional\.css\?v=[a-f0-9]+/.test(html),file+' must use versioned design');
  }
});
test('installable web app has stable identity and correctly sized local icons',()=>{
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'./');assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./login.html?source=installed');
  for(const icon of manifest.icons){const bytes=fs.readFileSync(path.join(root,icon.src));assert.equal(bytes.toString('ascii',1,4),'PNG');assert.equal(icon.sizes,bytes.readUInt32BE(16)+'x'+bytes.readUInt32BE(20));}
});
test('Vercel builds the public release and includes required build inputs',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));assert.equal(config.outputDirectory,'dist');assert.equal(config.buildCommand,'node scripts/prepare-release.cjs');
  assert.equal(config.cleanUrls,true);
  const rules=fs.readFileSync(path.join(root,'.vercelignore'),'utf8');assert(rules.includes('!scripts/prepare-release.cjs'));assert(rules.includes('!scripts/rebuild-offline-cache.cjs'));
});
test('deployed navigation and mapping frames use extensionless paths',()=>{
  const html=fs.readFileSync(path.join(root,'dist/farmer/plantation-form.html'),'utf8');assert(html.includes('href="plantations"'));assert(html.includes('src="mapping"'));assert(!/\b(?:href|src)="[^":]+\.html(?:[?#][^"]*)?"/.test(html));
});
