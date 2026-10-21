// Mapping history and review. Every query is scoped by Supabase RLS.
window.CacaoEnhance = (() => {
  const $=id=>document.getElementById(id);
  const node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value??'';return el;};
  const get=async query=>{const {data,error}=await query;if(error)throw error;return data;};
  const status=(value,error=false)=>notify('page-status',value,error);
  function action(label,handler){const button=node('button',label);button.type='button';button.className='text-btn';button.addEventListener('click',()=>Promise.resolve().then(handler).catch(error=>status(error.message,true)));return button;}
  async function history(){
    const farms=await listPlantations();
    const farmerId=new URLSearchParams(location.search).get('farmer');
    const allowed=farmerId?farms.filter(farm=>farm.farmer_id===farmerId):farms;
    for(const farm of allowed){const option=node('option',farm.name+' · '+farm.farmer_name);option.value=farm.id;$('history-farm').append(option);}
    const privileged=['admin','super_admin'].includes(currentAccount.profile.role);
    $('review-panel').classList.toggle('hidden',!privileged);
    let currentFarm;
    async function load(){
      const farm=farms.find(row=>row.id===$('history-farm').value);currentFarm=farm;
      if(!farm){status('Select a plantation to review its boundary and GPS history.');return;}
      const [versions,sessions,flags,reviews,logs]=await Promise.all([
        get(db.from('plantation_boundaries').select('*').eq('plantation_id',farm.id).order('recorded_at',{ascending:false})),
        get(db.from('gps_tracking_sessions').select('*').eq('plantation_id',farm.id).order('created_at',{ascending:false})),
        get(db.from('plantation_overlap_flags').select('*').eq('plantation_id',farm.id)),
        get(db.from('mapping_reviews').select('*').eq('plantation_id',farm.id).order('created_at',{ascending:false})),
        get(db.from('activity_logs').select('*').in('record_id',[farm.id,...(farm.farmer_id?[farm.farmer_id]:[])]).order('created_at',{ascending:false}))
      ]);
      $('history-summary').textContent=farm.name+' · revision '+farm.revision+' · '+farm.verification_status+' · '+Number(farm.area_sqm).toFixed(2)+' m²';
      const body=$('boundary-body');body.replaceChildren();
      for(const version of versions){
        const row=document.createElement('tr');row.append(node('td',version.revision||'Legacy'),node('td',CacaoApp.dateTime(version.recorded_at)),node('td',version.capture_method),node('td',Number(version.area_sqm).toFixed(2)));
        const actions=document.createElement('td');
        actions.append(action('Preview',()=>CacaoApp.drawMap([{...farm,boundary:version.boundary_geojson}],'history-map')),
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
          const points=await get(db.from('gps_tracking_points').select('*').eq('session_id',session.id).order('sequence_no'));
          const body=$('gps-points-body');body.replaceChildren();
          for(const point of points){const row=document.createElement('tr');for(const value of [point.sequence_no,point.latitude,point.longitude,point.accuracy,point.accepted?'accepted':point.exclusion_reason||'excluded',CacaoApp.dateTime(point.captured_at)])row.append(node('td',value));body.append(row);}
          $('gps-points-panel').classList.remove('hidden');
        }));gps.append(item);
      }
      if(!sessions.length)gps.append(node('li','No saved GPS sessions for this plantation.'));
      const reviewList=$('review-list');reviewList.replaceChildren();for(const review of reviews)reviewList.append(node('li',review.decision+' · revision '+review.reviewed_revision+' · '+review.note+' · '+CacaoApp.dateTime(review.created_at)));
      const logList=$('history-log');logList.replaceChildren();for(const log of logs)logList.append(node('li',log.action+' · '+log.record_type+' · '+(log.details?.changed_fields||[]).join(', ')+' · '+CacaoApp.dateTime(log.created_at)));
      CacaoApp.drawMap([farm],'history-map');status('');
    }
    $('history-farm').addEventListener('change',()=>load().catch(error=>status(error.message,true)));
    $('mapping-review-form').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.submitter||event.target.querySelector('button[type="submit"]');if(button)button.disabled=true;
      try{
        if(!currentFarm)throw new Error('Select a plantation.');
        if(!confirm('Submit this mapping review for revision '+currentFarm.revision+'?'))return;
        const updated=await get(db.rpc('review_plantation',{target:currentFarm.id,expected_revision:currentFarm.revision,decision:$('review-decision').value,note:$('review-note').value.trim()}));
        Object.assign(currentFarm,updated);await load();status('Mapping review saved.');
      }catch(error){status(error.message,true);}finally{if(button)button.disabled=false;}
    });
    if(allowed.length){const selected=new URLSearchParams(location.search).get('plantation');$('history-farm').value=allowed.some(farm=>farm.id===selected)?selected:allowed[0].id;await load();}
    else if(farmerId){
      const logs=await get(db.from('activity_logs').select('*').eq('record_id',farmerId).order('created_at',{ascending:false}));
      for(const log of logs)$('history-log').append(node('li',log.action+' · '+CacaoApp.dateTime(log.created_at)+' · '+(log.details?.changed_fields||[]).join(', ')));
      status('This farmer has no linked plantations yet. Available registration events appear below.');
    }else status('No authorized plantations yet.');
  }
  async function start(feature){try{if(!await requireSession())return;if(feature==='history')await history();}catch(error){status(error.message,true);}}
  return {start};
})();
