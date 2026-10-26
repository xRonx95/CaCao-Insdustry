// Farmer-only daily work summary. All reads retain database row-level access checks.
window.CacaoFarmerHome = (() => {
  const node=(tag,value,className)=>{const el=document.createElement(tag);el.textContent=value??'';if(className)el.className=className;return el;};
  const link=(label,href)=>{const el=node('a',label,'btn secondary');el.href=href;return el;};
  const owned=(rows,id)=>rows.filter(row=>row.owner_id===id);
  function model({farmers,plantations,harvests=[],treatments=[],reports=[]},id,today){
    const farms=owned(plantations,id),ids=new Set(farms.map(row=>row.id));
    const profiles=owned(farmers,id);
    const crops=owned(harvests,id).filter(row=>ids.has(row.plantation_id)).sort((a,b)=>(b.harvest_date||'').localeCompare(a.harvest_date||''));
    const openReports=new Set(owned(reports,id).filter(row=>ids.has(row.plantation_id)&&row.resolution_status!=='resolved').map(row=>row.id));
    const latest=new Map();
    for(const row of owned(treatments,id).filter(row=>ids.has(row.plantation_id)&&openReports.has(row.pest_report_id))){
      const prior=latest.get(row.pest_report_id);
      if(!prior||[row.treatment_date,row.created_at,row.id].join('|')>[prior.treatment_date,prior.created_at,prior.id].join('|'))latest.set(row.pest_report_id,row);
    }
    const reminders=[...latest.values()].filter(row=>row.next_inspection).sort((a,b)=>a.next_inspection.localeCompare(b.next_inspection));
    const progress={profile:profiles.length>0,approved:profiles.some(row=>row.registration_status==='approved'),mapped:farms.some(row=>row.boundary?.type==='Polygon'&&row.boundary.coordinates?.[0]?.length>=4),harvest:crops.length>0};
    return {farms,profiles,latestHarvest:crops[0],reminders,overdue:reminders.filter(row=>row.next_inspection<today).length,openReports:openReports.size,progress};
  }
  function guide(summary,harvestAvailable){
    const box=node('section','','farmer-guide');box.setAttribute('aria-label','Getting started');
    const heading=node('h3','Getting started');
    const label=node('label','Guide language');const language=node('select');language.setAttribute('aria-label','Guide language');
    for(const [value,text] of [['en','English'],['fil','Filipino']]){const option=node('option',text);option.value=value;language.append(option);}
    try{language.value=localStorage.getItem('caaps-guide-language')||'en';}catch{}
    const list=node('ol');label.append(language);box.append(heading,label,list);
    function paint(){
      const fil=language.value==='fil';heading.textContent=fil?'Gabay sa pagsisimula':'Getting started';list.replaceChildren();
      const steps=[
        [summary.progress.profile,'Create your farmer profile','Kumpletuhin ang iyong farmer profile','farmers.html'],
        [summary.progress.approved,'Review profile approval or requested corrections','Tingnan ang pag-apruba o kailangang iwasto','reviews.html'],
        [summary.progress.mapped,'Save your plantation boundary','I-save ang hangganan ng iyong sakahan','plantations.html'],
        [harvestAvailable?summary.progress.harvest:null,'Record your first harvest','Itala ang iyong unang ani','harvests.html']
      ];
      for(const [done,en,translated,href] of steps){const item=node('li');item.append(node('span',done===null?(fil?'Hindi makuha':'Unavailable'):done?(fil?'Naitala':'Recorded'):(fil?'Susunod na hakbang':'Next step'),'guide-status'),link(fil?translated:en,href));list.append(item);}
      const report=node('li');report.append(node('span',fil?'Ulat':'Report','guide-status'),link(fil?'Tingnan, i-print o i-export ang ulat ng ani':'View, print or export your harvest report','harvests.html#production-panel'));list.append(report);
    }
    language.addEventListener('change',()=>{try{localStorage.setItem('caaps-guide-language',language.value);}catch{}paint();});paint();
    box.append(link('Help & field guide','../help.html'));return box;
  }
  async function render(data){
    if(currentAccount.profile.role!=='farmer')return;
    document.getElementById('farmer-daily')?.remove();
    const root=node('section','','farmer-daily');root.id='farmer-daily';root.setAttribute('aria-label','My daily farm work');
    const title=node('h2','Your farm, at a glance');root.append(title,node('p','Choose a plantation, record today’s work, or review an update.'));
    const actions=node('nav','','farmer-actions');actions.setAttribute('aria-label','Daily farm actions');
    for(const [label,href] of [['Map my farm','plantation-form.html'],['Record harvest','harvests.html'],['Report a problem','pests.html'],['Add farm activity','maintenance.html']])actions.append(link(label,href));
    root.append(actions);
    const grid=node('div','','farmer-home-grid');root.append(grid);
    const own=owned(data.plantations,currentAccount.user.id);
    const farms=node('article','','panel');farms.append(node('h3','My plantations'));
    if(!own.length)farms.append(node('p','Start by registering your plantation. Your farmer account is selected automatically.'),link('Register my plantation','plantation-form.html'));
    for(const farm of own){const item=node('div','','farmer-farm-row');item.append(node('strong',farm.name),node('p',Number(farm.tree_count||0).toLocaleString()+' trees · '+(Number(farm.area_sqm||0)/10000).toFixed(2)+' ha'),link('Open farm records','plantation-workspace.html?id='+encodeURIComponent(farm.id)));farms.append(item);}
    grid.append(farms);
    const updates=node('article','','panel');updates.append(node('h3','Updates & reminders'));grid.append(updates);
    const profiles=owned(data.farmers,currentAccount.user.id);
    if(!profiles.length)updates.append(node('p','Complete your farmer profile so staff can review your registration.'),link('Complete my profile','farmers.html'));
    for(const profile of profiles){const status={approved:'Profile approved. You can continue managing your farm.',rejected:'Your profile needs corrections. Open the review inbox to read the feedback.',pending:'Your profile is waiting for staff review.'}[profile.registration_status]||'Open your profile to check its review status.';updates.append(node('p',status),link('View profile review','reviews.html?farmer='+encodeURIComponent(profile.id)));}
    const detail=node('p','Loading harvest and farm-health reminders…');updates.append(detail);
    const privacy=node('p','Your farm records stay within your authorized account access. Community posts you publish are public. Offline saving supports plantation mapping and tree inventories; connect to save harvests and other activities.','farmer-privacy');root.append(privacy,link('Review privacy notice','../privacy.html'));
    document.querySelector('#page-content .page-heading').after(root);
    const reportsPanel=document.querySelector('.farmer-reports');
    if(reportsPanel&&!reportsPanel.dataset.resizeReady){
      reportsPanel.dataset.resizeReady='true';
      reportsPanel.addEventListener('toggle',()=>{if(reportsPanel.open)requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));});
    }
    const outcomes=await Promise.allSettled(['harvests','pest_treatments','pest_reports'].map(table=>listAll(table)));
    if(!root.isConnected)return;
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const summary=model({...data,harvests:outcomes[0].status==='fulfilled'?outcomes[0].value:[],treatments:outcomes[1].status==='fulfilled'?outcomes[1].value:[],reports:outcomes[2].status==='fulfilled'?outcomes[2].value:[]},currentAccount.user.id,today);
    detail.remove();
    root.append(guide(summary,outcomes[0].status==='fulfilled'),link('Track harvest batches','batches.html')); 
    updates.append(node('p',outcomes[0].status==='rejected'?'Latest harvest unavailable. Open harvest records to retry.':summary.latestHarvest?'Latest harvest: '+summary.latestHarvest.harvest_date+' · '+Number(summary.latestHarvest.dry_bean_kg||0).toLocaleString()+' kg dry beans.':'No harvest recorded yet. Use Record harvest after your first harvest.'));
    if(outcomes[1].status==='rejected'||outcomes[2].status==='rejected')updates.append(node('p','Farm-health reminders unavailable. Open treatments to check follow-up dates.'));
    else{
      updates.append(node('p',summary.openReports+' unresolved farm-health reports.'));
      for(const reminder of summary.reminders.slice(0,3))updates.append(node('p',(reminder.next_inspection<today?'Overdue follow-up: ':'Next follow-up: ')+reminder.next_inspection+' · '+(summary.farms.find(f=>f.id===reminder.plantation_id)?.name||'My plantation')));
      if(summary.reminders.length)updates.append(link('Review treatment follow-ups','treatments.html'));
    }
  }
  return {render,model};
})();
