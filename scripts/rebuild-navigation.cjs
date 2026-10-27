// One sidebar structure shared across role pages; no runtime network dependency.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const item=(file,label,icon)=>({file,label,icon});
const escape=value=>value.replaceAll('&','&amp;');
let updated=0;
for(const role of ['admin','field','farmer']){
  const farmer=role==='farmer';
  const groups=[
    ['Post-harvest operations','harvest',[item('batches','Harvest batches','harvest'),item('harvests','Harvest & production','harvest')]],
    ['Profiles & reviews','people',[item('farmers',farmer?'My farmer profile':'Farmer profiles','people'),item('reviews','Profile review inbox','shield')]],
    ['Plantations & mapping','map',[item('plantations',farmer?'My plantations':'Plantation directory','leaf'),item('plantation-form','Register plantation','map'),item('atlas','Plantation map','map'),item('history','Boundary history & review','map'),item(role,'Farm dashboard','chart')]],
    ['Farm records','harvest',[item('trees','Tree inventories','chart'),item('pests','Pest & disease reports','leaf'),item('treatments','Treatments','task'),...(!farmer?[item('inspections','Follow-up inspections','task')]:[]),item('maintenance','Farm maintenance','task'),item('tree-events','Planting & replacement','leaf'),item('tree-tags','Individual tree tags','leaf')]],
    ...(!farmer?[
      ['Work & personnel','people',[item('tasks','Task schedule','task'),item('workers','Workers','people'),item('assignments','Worker assignments','task'),item('attendance','Worker attendance','people')]],
      ['Reports & activity','chart',[item('reports','Reports & exports','chart'),item('audit','Activity log','task')]]
    ]:[]),
    ['Tools & access','sync',[item('sync','Sync & recovery','sync'),item('../install','Install web app','home'),...(role==='admin'?[{...item('users','Users & access','shield'),superOnly:true}]:[])]],
    ['Community & help','home',[...(farmer?[item('posts','Share cacao','leaf')]:[]),item('../help','Help & field guide','home'),item('../index','Public community','home'),item('../privacy','Privacy notice','shield')]]
  ];
  for(const file of fs.readdirSync(path.join(root,role)).filter(file=>file.endsWith('.html'))){
    const target=path.join(root,role,file);let html=fs.readFileSync(target,'utf8');
    if(!html.includes('id="workspace-nav"'))continue;
    if(!html.includes('assets/js/access.js'))html=html.replace('<script defer src="../assets/js/workspace.js">','<script defer src="../assets/js/access.js"></script>\n    <script defer src="../assets/js/workspace.js">');
    if(!html.includes('assets/css/access.css'))html=html.replace('</head>','<link rel="stylesheet" href="../assets/css/access.css">\n  </head>');
    const current=file==='plantation-workspace.html'?'plantations.html':file;
    const link=entry=>`<a href="${entry.file}.html"${entry.superOnly?' data-super-only class="hidden"':''}${current===entry.file+'.html'?' aria-current="page"':''}><i data-local-icon="${entry.icon}" aria-hidden="true"></i><span>${escape(entry.label)}</span></a>`;
    const nav=`<nav id="workspace-nav" class="feature-nav" aria-label="${farmer?'Farmer':role==='field'?'Field personnel':'Administrator'} workspace navigation">
      <div class="sidebar-heading">${farmer?'MY FARM':role==='field'?'FIELD WORKSPACE':'ADMIN WORKSPACE'}</div>
      ${link(item('postharvest','Quality overview','home'))}
      ${groups.map(([title,icon,entries])=>`<details class="nav-group"${entries.some(entry=>current===entry.file+'.html')?' open':''}><summary><i data-local-icon="${icon}" aria-hidden="true"></i><span>${escape(title)}</span></summary>\n        ${entries.map(link).join('\n        ')}\n      </details>`).join('\n      ')}
      <div class="sidebar-location">Zamboanga del Norte<br>Philippines</div>
    </nav>`;
    html=html.replace(/<nav id="workspace-nav"[\s\S]*?<\/nav>/,nav);
    fs.writeFileSync(target,html);updated++;
  }
}
console.log('Organized sidebars on '+updated+' workspace pages.');
