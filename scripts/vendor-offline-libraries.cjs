// Keep browser dependencies in the app bundle so Android does not need a CDN offline.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const libraries = [
  ['https://unpkg.com/leaflet@1.9.4/dist/', 'assets/vendor/leaflet/', ['leaflet.js','leaflet.css','images/layers.png','images/layers-2x.png','images/marker-icon.png','images/marker-icon-2x.png','images/marker-shadow.png']],
  ['https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/', 'assets/vendor/leaflet-draw/', ['leaflet.draw.js','leaflet.draw.css','images/spritesheet.png','images/spritesheet-2x.png','images/spritesheet.svg']],
  ['https://cdn.jsdelivr.net/npm/@turf/turf@6.5.0/', 'assets/vendor/turf/', ['turf.min.js']],
  ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/', 'assets/vendor/supabase/', ['supabase.min.js']],
  ['https://unpkg.com/lucide@0.468.0/dist/umd/', 'assets/vendor/lucide/', ['lucide.min.js']]
];
async function main() {
  const replacements = new Map();
  for (const [origin, folder, files] of libraries) for (const file of files) {
    const destination = path.join(root, folder, file);
    if (!fs.existsSync(destination)) {
      const response = await fetch(origin + file, {signal:AbortSignal.timeout(60000)});
      if (!response.ok) throw new Error(`${response.status}: ${origin + file}`);
      fs.mkdirSync(path.dirname(destination), {recursive:true});
      fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    }
    replacements.set(origin + file, folder + file);
  }
  for (const directory of ['', 'farmer','admin','field']) for (const file of fs.readdirSync(path.join(root,directory)).filter(file=>file.endsWith('.html'))) {
    const destination=path.join(root,directory,file);
    let html=fs.readFileSync(destination,'utf8');
    for (const [url,local] of replacements) html=html.replaceAll(url,(directory?'../':'')+local);
    fs.writeFileSync(destination,html);
  }
  console.log('Offline mapping, account and icon libraries bundled locally.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
