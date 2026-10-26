// Public-page mobile navigation. Inline SVG icons work without a network library.
(() => {
  const navigation=document.querySelector('.public-nav'),header=document.querySelector('.topbar');
  if(!navigation||!header)return;
  document.body.classList.add('public-mobile-page');
  const paths={
    home:['m3 10 9-7 9 7','M5 9v12h14V9','M9 21v-8h6v8'],
    about:['M12 8h.01M11 12h1v5h1','M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'],
    impact:['M4 20V10M10 20V4M16 20v-7M22 20H2'],
    user:['M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0','M4 21v-2a8 8 0 0 1 16 0v2'],
    share:['M4 6h4l2-3h4l2 3h4v15H4V6Z','M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0'],
    map:['m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z','M9 3v15M15 6v15'],
    menu:['M4 6h16M4 12h12M4 18h8']
  };
  function icon(name){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    for(const [key,value]of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))svg.setAttribute(key,value);
    for(const data of paths[name]){const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',data);svg.append(path);}
    return svg;
  }
  const toggle=document.createElement('button');toggle.type='button';toggle.className='public-mobile-toggle';
  if(!navigation.id)navigation.id='public-navigation';
  toggle.setAttribute('aria-controls',navigation.id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');toggle.append(icon('menu'));
  header.insertBefore(toggle,navigation);
  function close(){navigation.classList.remove('public-nav-open');toggle.setAttribute('aria-expanded','false');}
  toggle.addEventListener('click',()=>{const expanded=navigation.classList.toggle('public-nav-open');toggle.setAttribute('aria-expanded',String(expanded));});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&navigation.classList.contains('public-nav-open')){close();toggle.focus();}});
  const dock=document.createElement('nav');dock.className='public-mobile-dock';dock.setAttribute('aria-label','Mobile navigation');
  for(const [label,href,name]of [['Home','index.html','home'],['About','about.html','about'],['Share','login.html','share'],['Impact','impact.html','impact'],['Account','login.html','user']]){
    const link=document.createElement('a');link.href=href;link.append(icon(name));const caption=document.createElement('span');caption.textContent=label;link.append(caption);
    if(name==='share')link.className='public-share-action';
    const page=(location.pathname.split('/').pop()||'index').replace(/\.html$/,'');
    if(page===href.replace(/\.html$/,'')&&name!=='share')link.setAttribute('aria-current','page');
    dock.append(link);
  }
  document.body.append(dock);
  const hero=document.querySelector('.community-hero');
  if(hero){
    const grid=document.createElement('nav');grid.className='public-mobile-actions';grid.setAttribute('aria-label','Explore cacao industry');
    for(const [label,href,name]of [['Farmer community','#feed-heading','home'],['Join as a farmer','signup.html','user'],['Plantation mapping','login.html','map'],['Share your cacao','login.html','share'],['About us','about.html','about'],['Our impact','impact.html','impact']]){
      const link=document.createElement('a');link.href=href;link.className='public-mobile-action';
      const badge=document.createElement('span');badge.className='public-action-icon';badge.append(icon(name));
      const title=document.createElement('span');title.textContent=label;link.append(badge,title);grid.append(link);
    }
    hero.after(grid);
  }
})();
