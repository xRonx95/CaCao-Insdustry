// Queue dashboard and explicit conflict review; local records are never silently overwritten.
window.CacaoSyncPage = (() => {
  const $=id=>document.getElementById(id);
  const node=(tag,value)=>{const result=document.createElement(tag);result.textContent=value??'';return result;};
  const status=(message,error=false)=>notify('page-status',message,error);
  let reviewing=null,server=null,comparisonMap=null;
  function action(label,fn){const button=node('button',label);button.className='text-btn';button.type='button';button.addEventListener('click',()=>Promise.resolve().then(fn).catch(error=>status(error.message,true)));return button;}
  function summary(value){if(value?.type==='Polygon')return 'Polygon · '+(value.coordinates?.[0]?.length-1)+' vertices';if(Array.isArray(value))return value.length+' recorded items';if(value&&typeof value==='object')return 'Structured record';return String(value??'');}
  async function render(){
    const rows=await CacaoSync.envelopes();$('sync-summary').textContent=rows.filter(row=>row.status==='pending').length+' pending · '+rows.filter(row=>row.status==='conflict').length+' conflicts · '+rows.filter(row=>['attention','blocked'].includes(row.status)).length+' need attention · '+rows.filter(row=>row.status==='synced').length+' confirmed';
    const body=$('sync-body');body.replaceChildren();
    for(const row of rows){const tr=document.createElement('tr');for(const value of [row.entity,row.status,row.attempts||0,CacaoApp.dateTime(row.createdAt),row.errorCode||'—'])tr.append(node('td',value));
      const actions=document.createElement('td');actions.append(action('Inspect / review',()=>review(row.id)));tr.append(actions);body.append(tr);}
    if(!rows.length){const tr=document.createElement('tr'),cell=node('td','No queued submissions for this account on this device.');cell.colSpan=6;tr.append(cell);body.append(tr);}
    $('sync-lock-state').textContent=CacaoSync.unlocked()?'Field data is unlocked in this tab. Retries run automatically while connected.':'Field data is locked. Unlock it to view records and resume retries.';
    $('service-worker-state').textContent=navigator.serviceWorker?.controller?'Offline page cache is active. Map tiles and private file downloads still require a connection.':'The offline page cache is not active yet. Prepare this device online and reload before field use.';
  }
  function comparisons(){
    const body=$('conflict-body');body.replaceChildren();
    for(const [name,value]of Object.entries(reviewing.change.payload)){
      const tr=document.createElement('tr');tr.append(node('td',name.replaceAll('_',' ')));
      const local=document.createElement('td');
      const protectedField=['owner_id','plantation_id','farmer_id','worker_id','pest_report_id','consent_at'].includes(name);
      if(value&&typeof value==='object'||protectedField){local.append(node('span',summary(value)));}
      else{
        const input=document.createElement('input');input.dataset.field=name;input.value=value??'';input.type=typeof value==='number'?'number':'text';if(typeof value==='number')input.step='any';input.disabled=['synced','superseded','archived'].includes(reviewing.metadata.status);local.append(input);
      }
      tr.append(local,node('td',server?summary(server[name]):'Load the server record to compare'));body.append(tr);
    }
    $('conflict-version').textContent='Queued '+reviewing.change.operation+' · '+reviewing.change.entity+' · server revision '+(server?.revision||'—');
    $('retry-reviewed').disabled=['synced','superseded','archived'].includes(reviewing.metadata.status);
    $('archive-change').disabled=reviewing.metadata.status==='synced';
    $('confirm-reviewed').checked=false;
    drawComparison();
  }
  function drawComparison(){
    const element=$('conflict-map');const local=reviewing.change.payload.boundary;
    if(!local&&!server?.boundary){element.classList.add('hidden');return;}
    element.classList.remove('hidden');
    if(!window.L){element.textContent='Map library is unavailable. Export both boundaries and review them before approving a revised submission.';return;}
    if(!comparisonMap){comparisonMap=L.map(element).setView([6.704,121.972],12);L.tileLayer(CACAO_MAP.tiles,{attribution:CACAO_MAP.attribution,maxZoom:CACAO_MAP.maxZoom}).addTo(comparisonMap);comparisonMap.records=L.featureGroup().addTo(comparisonMap);}
    comparisonMap.records.clearLayers();
    if(server?.boundary)comparisonMap.records.addLayer(L.geoJSON(server.boundary,{style:{color:'#287a4b',weight:4,fillOpacity:.1}}));
    if(local)comparisonMap.records.addLayer(L.geoJSON(local,{style:{color:'#ad762a',weight:2,dashArray:'6 5',fillOpacity:.12}}));
    if(comparisonMap.records.getLayers().length)comparisonMap.fitBounds(comparisonMap.records.getBounds(),{padding:[20,20]});setTimeout(()=>comparisonMap.invalidateSize(),50);
  }
  async function review(id){
    reviewing=await CacaoSync.inspect(id);server=null;comparisons();$('conflict-review').classList.remove('hidden');$('conflict-review').scrollIntoView({block:'start'});
  }
  async function start(){
    try{
      if(!await requireSession())return;
      $('sync-unlock').addEventListener('click',()=>CacaoSync.ensureUnlocked().then(render).catch(error=>status(error.message,true)));
      $('sync-now').addEventListener('click',async()=>{try{await CacaoSync.ensureUnlocked();await CacaoSync.retry();await render();}catch(error){status(error.message,true);}});
      $('prepare-field').addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await CacaoSync.prepare();status('Authorized records were encrypted for offline field use. Verify the offline page cache is active, then test airplane mode before leaving.');await render();}catch(error){status(error.message,true);}finally{button.disabled=false;}});
      $('remove-confirmed').addEventListener('click',async()=>{try{if(confirm('Remove only locally confirmed synchronization receipts? Pending, conflicted and archived drafts are retained.')){await CacaoSync.clearConfirmed();await render();}}catch(error){status(error.message,true);}});
      $('load-server').addEventListener('click',async()=>{
        try{if(!reviewing)throw new Error('Select a queued record.');if(!navigator.onLine)throw new Error('Connect before loading the current server record.');server=await getRecord(reviewing.change.entity,reviewing.change.recordId);comparisons();}catch(error){status(error.message,true);}
      });
      $('export-queued-boundary').addEventListener('click',()=>{const geometry=reviewing?.change.payload.boundary;if(geometry)CacaoIntegrity.download('queued-boundary.geojson',{type:'Feature',geometry,properties:{source:'queued',approximate:true}});else status('No boundary in this queued record.');});
      $('export-server-boundary').addEventListener('click',()=>{if(server?.boundary)CacaoIntegrity.download('server-boundary.geojson',{type:'Feature',geometry:server.boundary,properties:{revision:server.revision,approximate:true}});else status('Load a server plantation boundary first.');});
      $('retry-reviewed').addEventListener('click',async()=>{
        try{
          if(!$('confirm-reviewed').checked)throw new Error('Confirm you reviewed the queued and server values before creating a revised submission.');
          const payload={...reviewing.change.payload};
          for(const input of document.querySelectorAll('#conflict-body input')){
            const field=input.dataset.field,old=payload[field];payload[field]=input.value===''?null:typeof old==='number'?Number(input.value):input.value;
          }
          if(payload.first_name)payload.full_name=[payload.first_name,payload.middle_name,payload.last_name].filter(Boolean).join(' ');
          const result=await CacaoSync.revise(reviewing.metadata.id,payload,server);$('conflict-review').classList.add('hidden');await render();status(result.status==='synced'?'Revised record confirmed by the server.':'Revised change queued. The original encrypted version remains in history.');
        }catch(error){status(error.message,true);}
      });
      $('archive-change').addEventListener('click',async()=>{try{if(confirm('Keep the server record and archive this queued version without deleting its encrypted data?')){await CacaoSync.archive(reviewing.metadata.id);$('conflict-review').classList.add('hidden');await render();}}catch(error){status(error.message,true);}});
      window.addEventListener('cacao-sync-change',()=>render().catch(error=>status(error.message,true)));await render();
    }catch(error){status(error.message,true);}
  }
  return {start};
})();
