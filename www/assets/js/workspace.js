// Responsive workspace navigation; icons are optional, labels always remain visible.
(() => {
  const toggle = document.getElementById('nav-toggle');
  const navigation = document.getElementById('workspace-nav');
  const paths = {
    menu: ['M4 6h16M4 12h12M4 18h8'],
    home: ['m3 10 9-7 9 7', 'M5 9v12h14V9', 'M9 21v-8h6v8'],
    people: ['M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0', 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M16 4a4 4 0 0 1 0 8', 'M22 21v-2a4 4 0 0 0-3-3.87'],
    map: ['m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z', 'M9 3v15M15 6v15'],
    leaf: ['M20 4c-10-2-17 4-14 11s15 5 14-11Z', 'M4 21 16 9'],
    chart: ['M4 3v18h17', 'M8 16v-4M13 16V7M18 16v-6'],
    task: ['M8 4H5v17h14V4h-3', 'M8 2h8v5H8z', 'm8 14 3 3 5-6'],
    harvest: ['M4 9h16l-2 12H6L4 9Z', 'm8 9 4-7 4 7', 'M9 13v4M15 13v4'],
    sync: ['M20 7a8 8 0 0 0-14-2L3 8', 'M3 3v5h5', 'M4 17a8 8 0 0 0 14 2l3-3', 'M16 16h5v5'],
    shield: ['m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Z', 'm8 12 3 3 5-6']
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    for (const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'22',height:'22',fill:'none',stroke:'currentColor','stroke-width':'1.6','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
    for (const data of paths[name] || paths.leaf) {
      const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',data);svg.append(path);
    }
    return svg;
  }
  navigation?.querySelectorAll('[data-local-icon]').forEach(node=>node.replaceWith(icon(node.dataset.localIcon)));
  let dockMenu, shade;
  function setExpanded(expanded) {
    navigation?.classList.toggle('nav-open',expanded);
    toggle?.setAttribute('aria-expanded',String(expanded));
    dockMenu?.setAttribute('aria-expanded',String(expanded));
    shade?.classList.toggle('is-open',expanded);
  }
  toggle?.addEventListener('click', () => {
    setExpanded(!navigation?.classList.contains('nav-open'));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && navigation?.classList.contains('nav-open')) {
      setExpanded(false);
      toggle.focus();
    }
  });
  const header = document.querySelector('.topbar');
  if (header && toggle && navigation && document.body.classList.contains('workspace-page')) {
    toggle.replaceChildren(icon('menu'));
    toggle.setAttribute('aria-label','Open workspace menu');
    header.prepend(toggle);
    shade=document.createElement('button');shade.className='mobile-nav-shade';shade.type='button';
    shade.setAttribute('aria-label','Close workspace menu');shade.tabIndex=-1;
    shade.addEventListener('click',()=>{setExpanded(false);toggle.focus();});
    document.body.append(shade);
    const role=document.body.dataset.pageRole;
    const dock=document.createElement('nav');dock.className='mobile-dock';dock.setAttribute('aria-label','Mobile workspace');
    const dockLinks=role==='farmer'?[['Home','postharvest.html','home'],['Batches','batches.html','harvest'],['Map','atlas.html','map'],['Profile','farmers.html','people']]:[['Home','postharvest.html','home'],['Farmers','farmers.html','people'],['Map','atlas.html','map'],['Reports','reports.html','chart']];
    for (const [label,href,image] of dockLinks) {
      const link=document.createElement('a');link.href=href;link.append(icon(image));
      const caption=document.createElement('span');caption.textContent=label;link.append(caption);
      if(image==='map')link.className='mobile-map-action';
      if(location.pathname.replace(/\.html$/,'').endsWith('/'+href.replace(/\.html$/,'')))link.setAttribute('aria-current','page');
      dock.append(link);
    }
    dockMenu=document.createElement('button');dockMenu.type='button';dockMenu.setAttribute('aria-controls','workspace-nav');dockMenu.setAttribute('aria-expanded','false');
    dockMenu.append(icon('menu'));const caption=document.createElement('span');caption.textContent='More';dockMenu.append(caption);
    dockMenu.addEventListener('click',()=>{setExpanded(!navigation.classList.contains('nav-open'));if(navigation.classList.contains('nav-open'))navigation.querySelector('a[aria-current="page"]')?.focus();});
    dock.append(dockMenu);document.body.append(dock);
    navigation.addEventListener('click',event=>{if(event.target.closest('a'))setExpanded(false);});
    window.matchMedia('(max-width: 850px)').addEventListener('change',()=>setExpanded(false));
    if(document.body.dataset.feature==='dashboard') {
      const grid=document.createElement('nav');grid.className='mobile-shortcuts';grid.setAttribute('aria-label','Quick field actions');
      const shortcuts=role==='farmer'?[['My Plantation','plantations.html','leaf'],['Register Plantation','plantation-form.html','map'],['Plantation Map','atlas.html','map'],['Tree Inventories','trees.html','chart'],['Harvest records','harvests.html','harvest'],['Sync & recovery','sync.html','sync']]:[['Farmer profiles','farmers.html','people'],['Plantations','plantations.html','leaf'],['Map plantation','plantation-form.html','map'],['Harvest records','harvests.html','harvest'],['Farm tasks','tasks.html','task'],['Reports','reports.html','chart']];
      for(const [label,href,image] of shortcuts) {
        const link=document.createElement('a');link.href=href;link.className='mobile-shortcut';
        const badge=document.createElement('span');badge.className='mobile-shortcut-icon';badge.append(icon(image));
        const title=document.createElement('span');title.textContent=label;link.append(badge,title);grid.append(link);
      }
      document.querySelector('.page-heading')?.after(grid);
    }
  }
  if (header && window.ResizeObserver) new ResizeObserver(() => {
    document.documentElement.style.setProperty('--workspace-header', header.offsetHeight + 'px');
  }).observe(header);
  if (window.lucide) lucide.createIcons();
  if(window.Chart&&window.matchMedia){
    const mobileTheme=window.matchMedia('(max-width: 850px)');
    const original={color:Chart.defaults.color,borderColor:Chart.defaults.borderColor};
    const applyChartTheme=()=>{Chart.defaults.color=mobileTheme.matches?'#c6d4b2':original.color;Chart.defaults.borderColor=mobileTheme.matches?'#3a5740':original.borderColor;Object.values(Chart.instances).forEach(chart=>chart.update('none'));};
    applyChartTheme();mobileTheme.addEventListener('change',applyChartTheme);
  }
})();
