// Mapping history and review. Every query is scoped by Supabase RLS.
window.CacaoEnhance = (() => {
  const $=id=>document.getElementById(id);
  const node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value??'';return el;};
  const get=async query=>{const {data,error}=await query;if(error)throw error;return data;};
  const status=(value,error=false)=>notify('page-status',value,error);
  const canReview=role=>['admin','super_admin'].includes(role);
  const scope=(farms,account)=>account.profile.role==='farmer'?farms.filter(farm=>farm.owner_id===account.user.id):farms;
  async function rowsFor(table,key,id,order){
    const rows=[];
    for(let offset=0;;offset+=500){
      let query=db.from(table).select('*').eq(key,id);if(order)query=query.order(order,{ascending:false});query=query.order('id',{ascending:true});
      const chunk=await get(query.range(offset,offset+499));rows.push(...chunk);if(chunk.length<500)return rows;
    }
  }
  function action(label,handler){const button=node('button',label);button.type='button';button.className='text-btn';button.addEventListener('click',()=>Promise.resolve().then(handler).catch(error=>status(error.message,true)));return button;}
  async function history(){
    async function accessible(){return scope(currentAccount.profile.role==='farmer'?await rowsFor('plantations','owner_id',currentAccount.user.id,'created_at'):await listPlantations(),currentAccount);}
    let farms=await accessible();
    const farmerId=new URLSearchParams(location.search).get('farmer');
    let allowed=farmerId?farms.filter(farm=>farm.farmer_id===farmerId):farms;
    for(const farm of allowed){const option=node('option',farm.name+' · '+farm.farmer_name);option.value=farm.id;$('history-farm').append(option);}
    const privileged=canReview(currentAccount.profile.role);
    $('review-panel').classList.add('hidden');
    for(const control of $('mapping-review-form').elements)control.disabled=!privileged;
    let currentFarm,selectionVersion=0,reviewing=false;
    const search=$('history-search'),results=$('history-results');
    const plantationLabel=farm=>farm.name+' · '+farm.farmer_name;
    function searchResults(){
      if(!search||!results)return;
      const query=search.value.trim().toLocaleLowerCase();results.replaceChildren();results.hidden=!query;
      if(!query)return;
      const matches=allowed.filter(farm=>[farm.name,farm.farmer_name,farm.barangay].filter(Boolean).join(' ').toLocaleLowerCase().includes(query));
      for(const farm of matches.slice(0,30)){
        const button=action(plantationLabel(farm),async()=>{
          if(reviewing||$('history-farm').disabled)return;
          $('history-farm').value=farm.id;results.hidden=true;await load();search.focus();
        });results.append(button);
      }
      if(!matches.length)results.append(node('p','No matching plantations. Try another plantation or farmer name.'));
      if(matches.length>30)results.append(node('p',matches.length+' matches. Keep typing to narrow your search.'));
    }
    search?.addEventListener('input',()=>{
      if(reviewing)return;
      $('history-farm').value='';selectionVersion++;clear();displaySections(false);searchResults();
    });
    search?.addEventListener('focus',()=>search.select());
    search?.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'){results?.querySelector('button')?.focus();event.preventDefault();}
      if(event.key==='Escape'&&results)results.hidden=true;
    });
    function displaySections(show){
      for(const id of ['boundary-body','gps-session-list','review-list','history-log'])$(id).closest?.('section')?.classList.toggle('hidden',!show);
      $('history-map').classList.toggle('hidden',!show);$('overlap-list').classList.toggle('hidden',!show);$('overlap-list').previousElementSibling?.classList.toggle('hidden',!show);
    }
    function empty(){
      clear();displaySections(false);$('history-farm').disabled=true;
      if(search){search.value='';search.disabled=true;search.placeholder='No plantations available to this account';}if(results)results.hidden=true;
      const option=$('history-farm').children[0];if(option)option.textContent='No plantations available to this account';
      const role=currentAccount.profile.role;
      $('mapping-decision').textContent=role==='farmer'?'No saved plantations are available under your farmer account. Register a plantation or confirm that you are using the account that saved it.':canReview(role)?'No plantations match this view. Check the plantation directory and remove any farmer filter. If farmers have saved plantations, apply database migration 014 and refresh history.':'No plantations are visible to this staff account. Check Account access & review visibility above. A super administrator can assign the farmer account in Users & access; then choose Refresh history.';
      status(role==='farmer'?'No saved plantations for this farmer account.':canReview(role)?'No plantations in this view. Check filters and confirm database migration 014 is installed.':'No authorized plantations in this view. Check account assignments; this does not mean farmers have no plantations.');
    }
    function clear(){
      currentFarm=null;$('review-panel').classList.add('hidden');
      for(const id of ['boundary-body','overlap-list','gps-session-list','gps-points-body','review-list','history-log'])$(id).replaceChildren();
      $('gps-points-panel').classList.add('hidden');$('history-summary').textContent='';$('mapping-decision').textContent='';
      CacaoApp.drawMap([],'history-map');
    }
    async function load(){
      const version=++selectionVersion,id=$('history-farm').value;clear();
      displaySections(false);
      try{
      if(!allowed.some(row=>row.id===id)){status('Select a plantation to review its boundary and GPS history.');return;}
      if(search){search.value=plantationLabel(allowed.find(row=>row.id===id));search.disabled=false;search.placeholder='Type a plantation or farmer name…';}if(results)results.hidden=true;
      status('Loading selected plantation history…');
      const farm=await get(db.from('plantations').select('*').eq('id',id).single());
      if(version!==selectionVersion)return;
      if(!farm||!scope([farm],currentAccount).length)throw Error('This plantation is not available to your account.');
      const [versions,sessions,flags,reviews,logs]=await Promise.all([
        rowsFor('plantation_boundaries','plantation_id',id,'recorded_at'),
        rowsFor('gps_tracking_sessions','plantation_id',id,'created_at'),
        rowsFor('plantation_overlap_flags','plantation_id',id),
        rowsFor('mapping_reviews','plantation_id',id,'created_at'),
        rowsFor('activity_logs','record_id',id,'created_at')
      ]);
      if(version!==selectionVersion)return;
      currentFarm=farm;$('review-panel').classList.toggle('hidden',!privileged);
      displaySections(true);
      const decisionLabel={pending:'Pending administrator review',verified:'Verified by administrator',rejected:'Rejected — corrections required'};
      const latestDecision=reviews.find(review=>review.decision===farm.verification_status);
      $('mapping-decision').textContent=(decisionLabel[farm.verification_status]||'Review status unavailable')+(farm.verification_status==='pending'?'. Earlier decisions below remain historical.':latestDecision?' · Reviewed revision '+latestDecision.reviewed_revision+' · '+latestDecision.note:'');
      $('history-summary').textContent=farm.name+' · revision '+farm.revision+' · '+farm.verification_status+' · '+Number(farm.area_sqm).toFixed(2)+' m²';
      const body=$('boundary-body');body.replaceChildren();
      for(const version of versions){
        const row=document.createElement('tr');row.append(node('td',version.revision||'Legacy'),node('td',CacaoApp.dateTime(version.recorded_at)),node('td',version.capture_method),node('td',Number(version.area_sqm).toFixed(2)));
        const actions=document.createElement('td');
          actions.append(action('Preview',()=>{CacaoApp.drawMap([{...farm,boundary:version.boundary_geojson}],'history-map');currentFarm=null;$('review-panel').classList.add('hidden');status('Previewing a historical boundary. Use Refresh history to restore the current boundary before reviewing.');}),
          action('Export GeoJSON',()=>CacaoIntegrity.download('boundary-'+version.id+'.geojson',{type:'Feature',geometry:version.boundary_geojson,properties:{revision:version.revision,recorded_at:version.recorded_at,approximate:true}})),
          action('Review as new edit',()=>{location.href='plantation-form.html?id='+encodeURIComponent(farm.id)+'&version='+encodeURIComponent(version.id);}));
        row.append(actions);body.append(row);
      }
      if(!versions.length){const row=document.createElement('tr');const cell=node('td','No boundary versions recorded yet.');cell.colSpan=5;row.append(cell);body.append(row);}
      const list=$('overlap-list');list.replaceChildren();
      for(const flag of flags){const other=farms.find(row=>row.id===flag.other_plantation_id);list.append(node('li',Number(flag.overlap_sqm).toFixed(2)+' m² potential overlap with '+(other?other.name:'another private parcel')+'. Review required; shared edges alone are not flagged.'));}
      if(!flags.length)list.append(node('li','No positive-area overlaps detected in the current server geometry.'));
      const gps=$('gps-session-list');gps.replaceChildren();
      for(const session of sessions){
        const item=document.createElement('li');item.append(node('span',CacaoApp.dateTime(session.created_at)+' · revision '+(session.boundary_revision||'legacy')+' '));
        item.append(action('Recorded samples',async()=>{
          if(version!==selectionVersion)return;
          $('gps-points-body').replaceChildren();$('gps-points-panel').classList.add('hidden');
          const points=await rowsFor('gps_tracking_points','session_id',session.id,'sequence_no');
          if(version!==selectionVersion)return;
          const body=$('gps-points-body');body.replaceChildren();
          for(const point of points.sort((a,b)=>a.sequence_no-b.sequence_no)){const row=document.createElement('tr');for(const value of [point.sequence_no,point.latitude,point.longitude,point.accuracy,point.accepted?'accepted':point.exclusion_reason||'excluded',CacaoApp.dateTime(point.captured_at)])row.append(node('td',value));body.append(row);}
          $('gps-points-panel').classList.remove('hidden');
          if(!points.length){const row=node('tr'),cell=node('td','No recorded samples for this GPS session.');cell.colSpan=6;row.append(cell);body.append(row);}
        }));gps.append(item);
      }
      if(!sessions.length)gps.append(node('li',(farm.capture_method||versions[0]?.capture_method)==='manual'?'This boundary was drawn manually. No GPS walking session was recorded.':'No saved GPS sessions for this plantation. A GPS session appears only after GPS capture is saved.'));
      const reviewList=$('review-list');reviewList.replaceChildren();for(const review of reviews)reviewList.append(node('li',review.decision+' · revision '+review.reviewed_revision+' · '+review.note+' · '+CacaoApp.dateTime(review.created_at)));
      if(!reviews.length)reviewList.append(node('li','No administrator decision recorded yet.'));
      const logList=$('history-log');logList.replaceChildren();for(const log of logs)logList.append(node('li',log.action+' · '+log.record_type+' · '+(log.details?.changed_fields||[]).join(', ')+' · '+CacaoApp.dateTime(log.created_at)));
      CacaoApp.drawMap([farm],'history-map');status('');
      }catch(error){if(version===selectionVersion)throw error;}
    }
    $('history-farm').addEventListener('change',()=>load().catch(error=>status(error.message,true)));
    $('history-refresh').addEventListener('click',async()=>{
      if(reviewing)return;const previous=$('history-farm').value;selectionVersion++;clear();displaySections(false);$('history-farm').disabled=true;$('history-refresh').disabled=true;
      if(search)search.disabled=true;
      try{
        farms=await accessible();allowed=farmerId?farms.filter(farm=>farm.farmer_id===farmerId):farms;
        const blank=node('option','Select a plantation');blank.value='';$('history-farm').replaceChildren(blank);
        for(const farm of allowed){const option=node('option',farm.name+' · '+farm.farmer_name);option.value=farm.id;$('history-farm').append(option);}
        window.CacaoAccess?.refresh(currentAccount).catch(()=>{});
        if(allowed.length){$('history-farm').disabled=false;$('history-farm').value=allowed.some(farm=>farm.id===previous)?previous:allowed[0].id;await load();}else empty();
      }catch(error){status('Plantation access could not reload. '+error.message,true);}finally{$('history-refresh').disabled=false;if(search)search.disabled=!allowed.length;}
    });
    $('mapping-review-form').addEventListener('submit',async event=>{
      event.preventDefault();if(reviewing)return;
      if(!privileged){status('Only administrators may verify or reject a boundary.',true);return;}
      const button=event.submitter||event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
      reviewing=true;$('history-farm').disabled=true;$('history-refresh').disabled=true;
      if(search)search.disabled=true;if(results)results.hidden=true;
      try{
        if(!currentFarm)throw new Error('Select a plantation.');
        if(!confirm('Submit this mapping review for revision '+currentFarm.revision+'?'))return;
        const updated=await get(db.rpc('review_plantation',{target:currentFarm.id,expected_revision:currentFarm.revision,decision:$('review-decision').value,note:$('review-note').value.trim()}));
        Object.assign(currentFarm,updated);$('review-note').value='';
        try{await load();status('Administrator decision saved. The farmer can view it in boundary history.');}
        catch{status('Decision saved, but history could not reload. Refresh before submitting another review.',true);}
      }catch(error){status(error.message,true);}finally{reviewing=false;$('history-farm').disabled=false;$('history-refresh').disabled=false;if(search)search.disabled=false;if(button)button.disabled=false;}
    });
    if(allowed.length){const selected=new URLSearchParams(location.search).get('plantation');$('history-farm').value=allowed.some(farm=>farm.id===selected)?selected:allowed[0].id;await load();}
    else empty();
  }
  async function start(feature){try{if(!await requireSession())return;if(feature==='history')await history();}catch(error){status(error.message,true);}}
  return {start,scope,canReview};
})();
