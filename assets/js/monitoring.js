// Harvest, health, work and tree-event modules with real Supabase persistence.
window.CacaoMonitoring = (() => {
  const $=id=>document.getElementById(id);
  const node=(tag,value)=>{const item=document.createElement(tag);item.textContent=value??'';return item;};
  const get=async query=>{const {data,error}=await query;if(error)throw error;return data;};
  const message=(value,error=false)=>notify('page-status',value,error);
  const staff=()=>['admin','super_admin','field'].includes(currentAccount.profile.role);
  function summarizeHarvest(rows,groupBy='month'){
    const groups=new Map();
    for(const row of rows){
      const key=groupBy==='plantation'?row.plantation_id:row.harvest_date.slice(0,groupBy==='year'?4:7);
      const group=groups.get(key)||{period:key,wet_bean_kg:0,dry_bean_kg:0,harvested_pods:0,estimated_value_php:0,areas:new Map()};
      for(const field of ['wet_bean_kg','dry_bean_kg','harvested_pods','estimated_value_php'])group[field]+=Number(row[field]||0);
      const area=group.areas.get(row.plantation_id);
      if(!area||area.date<row.harvest_date||(area.date===row.harvest_date&&area.created_at<row.created_at))group.areas.set(row.plantation_id,{date:row.harvest_date,created_at:row.created_at,area:Number(row.area_sqm_at_harvest||0)});
      groups.set(key,group);
    }
    return [...groups.values()].sort((a,b)=>a.period.localeCompare(b.period)).map(({areas,...row})=>{
      const area_sqm=[...areas.values()].reduce((sum,entry)=>sum+entry.area,0);
      return {...row,area_sqm,dry_kg_per_ha:area_sqm?row.dry_bean_kg*10000/area_sqm:null};
    });
  }
  function validate(values,definition){
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(part=>[part.type,part.value]));
    const today=parts.year+'-'+parts.month+'-'+parts.day;
    for(const [name,label,type,required,options] of definition.fields){
      const value=values[name];
      if(required&&(value==null||value===''))throw new Error(label+' is required.');
      if(value==null||value==='')continue;
      if(['integer','positive','decimal','money','hours','latitude','longitude'].includes(type)){
        if(!Number.isFinite(Number(value)))throw new Error(label+' must be a finite number.');
        const min=type==='latitude'?-90:type==='longitude'?-180:type==='positive'?1:0;
        const max=type==='latitude'?90:type==='longitude'?180:type==='hours'?24:999999999;
        if(Number(value)<min||Number(value)>max)throw new Error(label+' is outside its permitted range.');
        if(['integer','positive'].includes(type)&&!Number.isSafeInteger(Number(value)))throw new Error(label+' must be a whole number.');
      }
      if(type==='select'&&!options.includes(value))throw new Error('Invalid '+label+'.');
      if(type==='date'&&name!=='scheduled_on'&&name!=='next_inspection'&&value>today)throw new Error(label+' cannot be in the future.');
    }
    if(definition.table==='harvests'){
      if(Number(values.wet_bean_kg)>0&&Number(values.dry_bean_kg)>Number(values.wet_bean_kg))throw new Error('Dry bean weight cannot exceed the recorded wet weight.');
      if(!Number(values.harvested_pods)&&!Number(values.wet_bean_kg)&&!Number(values.dry_bean_kg))throw new Error('Record at least one harvested pod or a positive bean weight.');
    }
    if(definition.table==='plantation_tasks'&&values.status==='completed'&&!values.completed_on)throw new Error('A completed task needs a completion date.');
    if(definition.table==='worker_attendance'&&values.status==='absent'&&Number(values.hours)!==0)throw new Error('Absent workers must have zero recorded hours.');
    if(definition.table==='cacao_trees'&&((values.latitude==null)!==(values.longitude==null)))throw new Error('Provide both latitude and longitude, or leave both blank.');
  }
  async function start(feature){
    try{
      if(!await requireSession())return;
      const definition=CacaoModules[feature];
      let farms=await listPlantations();
      let workers=definition.fields.some(field=>field[2]==='worker')?await listAll('workers'):[];
      let pests=definition.fields.some(field=>field[2]==='pest')?await listAll('pest_reports'):[];
      if(window.CacaoSync){farms=await CacaoSync.recordsForPicker('plantations',farms);workers=await CacaoSync.recordsForPicker('workers',workers);pests=await CacaoSync.recordsForPicker('pest_reports',pests);}
      let rows=[],editing=null,page=0,recordId=crypto.randomUUID(),changeId=crypto.randomUUID(),productionChart;
      function options(select,records,label,required=false){select.replaceChildren();const empty=node('option',required?'Select…':'None');empty.value='';select.append(empty);for(const row of records){const option=node('option',row[label]);option.value=row.id;select.append(option);}}
      options($('plantation_id'),farms,'name',true);
      function dependents(){const farm=farms.find(row=>row.id===$('plantation_id').value);if($('worker_id'))options($('worker_id'),workers.filter(w=>w.owner_id===farm?.owner_id),'full_name',feature==='attendance');if($('pest_report_id'))options($('pest_report_id'),pests.filter(p=>p.plantation_id===farm?.id),'pest_name',true);}
      $('plantation_id').addEventListener('change',dependents);dependents();
      if(definition.staffOnly&&!staff())$('monitor-editor').classList.add('hidden');
      options($('farm-filter'),farms,'name');$('farm-filter').options[0].textContent='All plantations';
      function filtered(){const search=$('monitor-search').value.trim().toLowerCase(),farm=$('farm-filter').value,from=$('monitor-from').value,to=$('monitor-to').value;return rows.filter(row=>{
        const name=farms.find(f=>f.id===row.plantation_id)?.name||'',worker=workers.find(w=>w.id===row.worker_id)?.full_name||'';
        return (!farm||row.plantation_id===farm)&&(!from||row[definition.date]>=from)&&(!to||row[definition.date]<=to)&&(!search||Object.values(row).concat(name,worker).join(' ').toLowerCase().includes(search));
      });}
      const labels={plantation:'Plantation',pest:'Pest report',worker:'Worker',dry_kg_per_ha:'Dry kg/ha',wet_bean_kg:'Wet kg',dry_bean_kg:'Dry kg',estimated_value_php:'Value (PHP)'};
      function display(row,key){if(key==='plantation')return farms.find(f=>f.id===row.plantation_id)?.name||row.plantation_id;if(key==='worker')return workers.find(w=>w.id===row.worker_id)?.full_name||'—';if(key==='pest')return pests.find(p=>p.id===row.pest_report_id)?.pest_name||'—';if(key==='tree_age_months'){if(!row.planted_on)return 'Unknown';const planted=new Date(row.planted_on),now=new Date();return Math.max(0,(now.getFullYear()-planted.getFullYear())*12+now.getMonth()-planted.getMonth());}return typeof row[key]==='number'?Number(row[key]).toLocaleString(undefined,{maximumFractionDigits:3}):row[key]??'—';}
      function render(){
        const matches=filtered(),max=Math.max(0,Math.ceil(matches.length/15)-1);page=Math.min(page,max);
        $('monitor-head').replaceChildren(...definition.columns.map(key=>node('th',labels[key]||key.replaceAll('_',' '))),node('th','Actions'));
        const body=$('monitor-body');body.replaceChildren();
        for(const row of matches.slice(page*15,page*15+15)){
          const tr=document.createElement('tr');for(const key of definition.columns)tr.append(node('td',display(row,key)));
          const actions=document.createElement('td');
          if(definition.mutable&&(!definition.staffOnly||staff())){
            const edit=node('button','Edit');edit.className='text-btn';edit.type='button';edit.addEventListener('click',()=>{
              editing=row;recordId=row.id;changeId=crypto.randomUUID();$('monitor-form').reset();$('plantation_id').value=row.plantation_id;dependents();
              for(const [key,value]of Object.entries(row)){const control=$('monitor-form').elements.namedItem(key);if(control&&control.type!=='file')control.value=value??'';}
              $('plantation_id').disabled=true;$('monitor-form-title').textContent='Edit record';$('monitor-form').scrollIntoView({block:'start'});
            });actions.append(edit);
          }
          if(row.evidence_path){const photo=node('button','Evidence');photo.type='button';photo.className='text-btn';photo.addEventListener('click',()=>CacaoApp.viewPhoto(row.evidence_path).catch(error=>message(error.message,true)));actions.append(photo);}
          tr.append(actions);body.append(tr);
        }
        if(!matches.length){const tr=document.createElement('tr'),cell=node('td','No matching records yet.');cell.colSpan=definition.columns.length+1;tr.append(cell);body.append(tr);}
        $('monitor-count').textContent=matches.length+' records · page '+(page+1)+' of '+(max+1);$('monitor-previous').disabled=page===0;$('monitor-next').disabled=page>=max;
        if(feature==='harvests')production(matches);
      }
      function production(matches){
        const summary=summarizeHarvest(matches,$('production-group').value),body=$('production-body');body.replaceChildren();
        for(const row of summary){const tr=document.createElement('tr');for(const key of ['period','wet_bean_kg','dry_bean_kg','harvested_pods','estimated_value_php','dry_kg_per_ha'])tr.append(node('td',key==='period'?(farms.find(f=>f.id===row.period)?.name||row.period):row[key]==null?'Not mapped':Number(row[key]).toLocaleString(undefined,{maximumFractionDigits:3})));body.append(tr);}
        if(window.Chart){productionChart?.destroy();productionChart=new Chart($('production-chart'),{type:'bar',data:{labels:summary.map(r=>farms.find(f=>f.id===r.period)?.name||r.period),datasets:[{label:'Dry beans (kg)',data:summary.map(r=>r.dry_bean_kg),backgroundColor:'#287a4b'},{label:'Wet beans (kg)',data:summary.map(r=>r.wet_bean_kg),backgroundColor:'#a27c42'}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}});}
        const dry=matches.reduce((sum,row)=>sum+Number(row.dry_bean_kg),0),wet=matches.reduce((sum,row)=>sum+Number(row.wet_bean_kg),0);
        $('production-totals').textContent='Recorded dry beans: '+dry.toFixed(3)+' kg · wet beans: '+wet.toFixed(3)+' kg. These are separate measures and are not added together.';
      }
      async function refresh(){rows=await listAll(definition.table);rows.sort((a,b)=>(b[definition.date]||'').localeCompare(a[definition.date]||''));render();}
      function reset(){editing=null;recordId=crypto.randomUUID();changeId=crypto.randomUUID();$('monitor-form').reset();$('plantation_id').disabled=false;dependents();$('monitor-form-title').textContent='New record';}
      $('monitor-reset').addEventListener('click',reset);
      for(const id of ['monitor-search','farm-filter','monitor-from','monitor-to','production-group'])$(id)?.addEventListener(id==='monitor-search'?'input':'change',()=>{page=0;render();});
      $('monitor-previous').addEventListener('click',()=>{page--;render();});$('monitor-next').addEventListener('click',()=>{page++;render();});
      $('monitor-refresh').addEventListener('click',()=>refresh().catch(error=>message(error.message,true)));
      const displayedConfirmations=new Set();
      window.addEventListener('cacao-sync-change',()=>{
        if(!navigator.onLine||!window.CacaoSync?.unlocked())return;
        CacaoSync.envelopes().then(async entries=>{
          const fresh=entries.filter(entry=>entry.entity===definition.table&&entry.status==='synced'&&!displayedConfirmations.has(entry.id));
          if(!fresh.length)return;
          fresh.forEach(entry=>displayedConfirmations.add(entry.id));
          await refresh();message('Synchronization confirmed. Recorded history is updated.');
        }).catch(error=>message(error.message,true));
      });
      $('monitor-form').addEventListener('submit',async event=>{
        event.preventDefault();const button=$('monitor-save');button.disabled=true;
        try{
          const values={};for(const [name,label,type]of definition.fields){const control=event.target.elements.namedItem(name);if(type==='file')continue;let value=control.value.trim();if(['integer','positive','decimal','money','hours','latitude','longitude'].includes(type))value=value===''?null:Number(value);else if(type==='date'||type==='worker')value=value||null;values[name]=value;}
          const farm=farms.find(row=>row.id===values.plantation_id);if(!farm)throw new Error('Select an authorized plantation.');
          validate(values,definition);
          if(feature==='treatments'&&values.next_inspection&&values.next_inspection<values.treatment_date)throw new Error('Follow-up inspection cannot precede treatment.');
          const file=event.target.elements.evidence?.files[0];
          if(file){if(!navigator.onLine)throw new Error('Evidence uploads need a connection. Save the record without a photo, then attach it online.');values.evidence_path=await CacaoApp.upload(file,farm.owner_id);}
          let saved;
          if(window.CacaoSync)saved=await CacaoSync.submit({changeId,entity:definition.table,recordId,expected:editing?.updated_at||null,payload:{...values,owner_id:farm.owner_id}});
          else {const query=editing?db.from(definition.table).update(values).eq('id',editing.id).eq('updated_at',editing.updated_at):db.from(definition.table).insert({...values,id:recordId,owner_id:farm.owner_id});const row=await get(query.select().maybeSingle());if(!row)throw new Error('This record changed. Refresh before editing again.');saved={status:'synced',record:row};}
          reset();if(saved.status==='synced')await refresh();message(saved.status==='queued'?'Saved in the encrypted queue. It will retry when connected and unlocked.':'Agricultural record saved.');
        }catch(error){message(error.message,true);}finally{button.disabled=false;}
      });
      function exportRows(summary=false){
        const rows=summary?summarizeHarvest(filtered(),$('production-group').value):filtered();
        const columns=summary?['period','wet_bean_kg','dry_bean_kg','harvested_pods','estimated_value_php','dry_kg_per_ha']:definition.columns;
        const content='\uFEFF'+[columns,...rows.map(row=>columns.map(key=>summary?row[key]:display(row,key)))].map(row=>row.map(CacaoApp.csvValue).join(',')).join('\r\n');
        const url=URL.createObjectURL(new Blob([content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=feature+(summary?'-production':'')+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
      $('monitor-export').addEventListener('click',()=>exportRows());$('production-export')?.addEventListener('click',()=>exportRows(true));
      $('monitor-print').addEventListener('click',()=>window.print());
      if(feature==='tree-tags')$('tag-location').addEventListener('click',()=>{if(!navigator.geolocation)return message('Geolocation unavailable.',true);navigator.geolocation.getCurrentPosition(position=>{$('latitude').value=position.coords.latitude;$('longitude').value=position.coords.longitude;message('Tree location captured; reported accuracy ±'+Math.round(position.coords.accuracy)+' m.');},error=>message(error.message,true),{enableHighAccuracy:true,timeout:20000});});
      await refresh();
    }catch(error){message(error.message,true);}
  }
  return {start,summarizeHarvest,validate};
})();
