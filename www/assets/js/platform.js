// Reusable operational modules. Role-specific entry points live in each assets/js role folder.
window.CacaoApp = (() => {
  const el = id => document.getElementById(id);
  const state = { rows: [], page: 0, size: 15, charts: [], map: null };
  const text = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value ?? '';
    if (className) node.className = className;
    return node;
  };
  const message = (value, error = false) => notify('page-status', value, error);
  const number = value => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const dateTime = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const staff = () => ['admin','super_admin','field'].includes(currentAccount.profile.role);
  const admin = () => ['admin','super_admin'].includes(currentAccount.profile.role);
  let records = [], farms = [], users = [], editing = null;

  async function result(query) {
    const { data, error } = await query;
    if (error) throw error;
    return data;
  }
  function busy(button, value) { if (button) button.disabled = value; }
  function filtered(rows = state.rows) {
    const search = (el('search')?.value || '').trim().toLowerCase();
    const barangay = el('barangay-filter')?.value || '';
    const status = el('status-filter')?.value || '';
    const from = el('date-from')?.value;
    const to = el('date-to')?.value;
    const plantation = new URLSearchParams(location.search).get('plantation');
    return rows.filter(row => {
      if (plantation && row.plantation_id && row.plantation_id !== plantation) return false;
      const date = row.inventory_date || row.created_at?.slice(0,10) || '';
      return (!search || Object.values(row).filter(v => typeof v === 'string').join(' ').toLowerCase().includes(search))
        && (!barangay || row.barangay === barangay)
        && (!status || (row.registration_status || row.status || row.employment_status) === status)
        && (!from || date >= from) && (!to || date <= to);
    });
  }
  function option(select, value, label) {
    const node = text('option', label); node.value = value; select.append(node);
  }
  function setOptions(id, rows, key = 'id', label = 'name', blank = 'Select…') {
    const select = el(id); if (!select) return;
    select.replaceChildren(); option(select, '', blank);
    for (const row of rows) option(select, row[key], row[label]);
  }
  function toolbar(rows) {
    if (el('barangay-filter')) {
      const barangays = [...new Set(rows.map(row => row.barangay).filter(Boolean))].sort();
      setOptions('barangay-filter', barangays.map(value => ({ id: value, name: value })), 'id','name','All barangays');
    }
  }
  function table(rows, columns, actions) {
    const body = el('records-body'); if (!body) return;
    body.replaceChildren();
    const matches = filtered(rows);
    const maxPage = Math.max(0, Math.ceil(matches.length / state.size) - 1);
    state.page = Math.min(state.page, maxPage);
    const visible = matches.slice(state.page * state.size, (state.page + 1) * state.size);
    for (const row of visible) {
      const tr = document.createElement('tr');
      for (const column of columns) {
        const value = typeof column.value === 'function' ? column.value(row) : row[column.key];
        tr.append(text('td', value ?? '—'));
      }
      if (actions) {
        const td = document.createElement('td'); td.className = 'row-actions';
        for (const action of actions(row)) {
          const button = text('button', action.label, 'text-btn'); button.type = 'button';
          button.addEventListener('click', () => Promise.resolve().then(() => action.run(row)).catch(error => message(error.message, true)));
          td.append(button);
        }
        tr.append(td);
      }
      body.append(tr);
    }
    if (!visible.length) {
      const td = text('td', 'No records match the current filters.'); td.colSpan = columns.length + (actions ? 1 : 0);
      const tr = document.createElement('tr'); tr.append(td); body.append(tr);
    }
    if (el('record-count')) el('record-count').textContent = matches.length + ' records · page ' + (state.page + 1) + ' of ' + (maxPage + 1);
    busy(el('previous-page'), state.page === 0); busy(el('next-page'), state.page >= maxPage);
  }
  function bindTable(render) {
    for (const id of ['search','barangay-filter','status-filter','date-from','date-to']) {
      el(id)?.addEventListener(id === 'search' ? 'input' : 'change', () => { state.page = 0; render(); });
    }
    el('previous-page')?.addEventListener('click', () => { state.page--; render(); });
    el('next-page')?.addEventListener('click', () => { state.page++; render(); });
  }
  function formValues(form) {
    const values = {};
    for (const [key, value] of new FormData(form)) {
      const control = form.elements.namedItem(key);
      if (control.type === 'file') continue;
      values[key] = control.type === 'number' ? (value === '' ? null : Number(value)) : String(value).trim();
    }
    return values;
  }
  function loadForm(row) {
    editing = row;
    const form = el('record-form'); form.reset();
    for (const [key, value] of Object.entries(row)) {
      const control = form.elements.namedItem(key);
      if (control && control.type !== 'file') control.value = value ?? '';
    }
    el('form-heading').textContent = 'Edit record';
    form.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  async function upload(file, owner, allowPdf = false) {
    if (!file?.size) return null;
    const types = { 'image/jpeg': 'jpg','image/png': 'png','image/webp': 'webp' };
    if (allowPdf) types['application/pdf'] = 'pdf';
    if (!Object.hasOwn(types,file.type) || file.size > 5 * 1024 * 1024) throw new Error('Use JPEG, PNG or WebP' + (allowPdf ? ' or PDF' : '') + ', maximum 5 MB.');
    const path = owner + '/' + crypto.randomUUID() + '.' + types[file.type];
    await result(db.storage.from('farm-private').upload(path,file,{ contentType:file.type,upsert:false }));
    return path;
  }
  async function viewPhoto(path) {
    if (!path) return;
    const { signedUrl } = await result(db.storage.from('farm-private').createSignedUrl(path,60));
    const link = document.createElement('a'); link.href = signedUrl; link.target = '_blank'; link.rel = 'noopener'; link.click();
  }
  async function ownerOptions() {
    const allFarmers = await listAll('farmers');
    const owners = new Map([[currentAccount.user.id, 'My account']]);
    for (const farmer of allFarmers) owners.set(farmer.owner_id, farmer.full_name + ' · ' + farmer.owner_id.slice(0,8));
    if(staff()&&currentAccount.profile.role!=='super_admin'){
      const assignments=!navigator.onLine&&window.CacaoSync?await CacaoSync.cached('staff_farmer_assignments'):await result(db.from('staff_farmer_assignments').select('farmer_owner_id').eq('staff_id',currentAccount.user.id));
      for(const assignment of assignments)if(!owners.has(assignment.farmer_owner_id))owners.set(assignment.farmer_owner_id,'Assigned account · '+assignment.farmer_owner_id.slice(0,8));
    }
    if (currentAccount.profile.role === 'super_admin') {
      users = await listAll('profiles');
      for (const profile of users.filter(user => user.role === 'farmer')) owners.set(profile.id, profile.display_name || profile.id);
    }
    setOptions('owner_id', [...owners].map(([id,name]) => ({id,name})), 'id','name','Select record owner');
    if (el('owner_id')) el('owner_id').value = currentAccount.user.id;
    return allFarmers;
  }

  async function registry(feature) {
    const isFarmer = feature === 'farmers';
    const tableName = isFarmer ? 'farmers' : 'workers';
    let recordId=crypto.randomUUID(),changeId=crypto.randomUUID(),editingId=null,consentAt=null;
    await ownerOptions();
    if(isFarmer)farms=await listPlantations();
    if (!isFarmer && !staff()) el('editor-panel').classList.add('hidden');
    const columns = isFarmer ? [
      {key:'full_name'}, {key:'barangay'}, {key:'contact_number'}, {value:row=>({pending:'Pending review',approved:'Approved',rejected:'Needs correction'})[row.registration_status]||row.registration_status},
      {value: row => row.farmer_code || 'CF-' + row.id.replaceAll('-','').toUpperCase()},
      {value: row => farms.filter(farm=>farm.farmer_id===row.id).length}
    ] : [{key:'full_name'},{key:'position'},{key:'phone'},{key:'employment_status'},{key:'employment_type'}];
    const actions = row => {
      const list = [];
      if (isFarmer || staff()) list.push({label:'Edit',run:()=>loadForm(row)});
      if(isFarmer)list.push({label:'History',run:()=>{location.href='history.html?farmer='+encodeURIComponent(row.id);}});
      if (row.photo_path) list.push({label:'Photo',run:()=>viewPhoto(row.photo_path)});
      if (isFarmer) list.push({label:'Documents',run:async()=>{
        const documents=await result(db.from('farmer_documents').select('id,path,label,created_at').eq('farmer_id',row.id).order('created_at',{ascending:false}));
        el('documents-panel').classList.remove('hidden');const list=el('document-list');list.replaceChildren();
        for(const documentRow of documents){const li=document.createElement('li');const button=text('button',documentRow.label+' · '+dateTime(documentRow.created_at),'text-btn');button.type='button';button.addEventListener('click',()=>viewPhoto(documentRow.path).catch(error=>message(error.message,true)));li.append(button);list.append(li);}
        if(!documents.length)list.append(text('li','No supporting documents for '+row.full_name+'.'));
        list.scrollIntoView({block:'nearest'});
      }});
      if (isFarmer) list.push({label:'Review & feedback',run:()=>{location.href='reviews.html?farmer='+encodeURIComponent(row.id);}});
      return list;
    };
    const requestedProfile=isFarmer?new URLSearchParams(location.search).get('id'):null;
    const render = () => table(state.rows,columns,actions);
    async function refresh() {
      state.rows = await listAll(tableName); toolbar(state.rows); render();
      if(requestedProfile&&!editing){const profile=state.rows.find(row=>row.id===requestedProfile);if(profile)loadForm(profile);}
    }
    bindTable(render);
    el('refresh-records').addEventListener('click', () => refresh().catch(error=>message(error.message,true)));
    el('reset-record').addEventListener('click',()=>{
      editing=null;el('record-form').reset();el('owner_id').value=currentAccount.user.id;el('form-heading').textContent='New record';
      recordId=crypto.randomUUID();changeId=crypto.randomUUID();editingId=null;consentAt=null;
    });
    el('record-form').addEventListener('submit',async event=>{
      event.preventDefault();const button=el('save-record');busy(button,true);
      let path,recordSaved=false;
      try {
        const values=formValues(event.target);
        delete values.consent;
        const owner=editing?.owner_id || values.owner_id;
        delete values.owner_id;
        if (!values.first_name || !values.last_name) throw new Error('First and last name are required.');
        values.full_name=[values.first_name,values.middle_name,values.last_name].filter(Boolean).join(' ');
        if(isFarmer&&window.CacaoIntegrity){
          const possible=CacaoIntegrity.duplicates(state.rows,{...values,owner_id:owner},editing?.id);
          if(possible.length&&!confirm('There are '+possible.length+' similar farmer records in your authorized directory. Continue only if this is a different person?'))return;
        }
        if (values.birth_date && values.birth_date > new Date().toISOString().slice(0,10)) throw new Error('Birth date cannot be in the future.');
        for (const key of ['birth_date','hired_on','experience_years']) if (values[key]==='') values[key]=null;
        if((editing?.id||null)!==editingId){editingId=editing?.id||null;changeId=crypto.randomUUID();consentAt=null;}
        const photoFile=event.target.elements.photo.files[0],documentFile=event.target.elements.supporting_document?.files[0];
        if(!navigator.onLine&&(photoFile?.size||documentFile?.size))throw new Error('Save the record without attachments while offline. Add photos and documents after synchronization.');
        path=await upload(photoFile,owner);
        if (path) values.photo_path=path;
        if (isFarmer) values.consent_at=consentAt||(consentAt=new Date().toISOString());
        const response=window.CacaoSync?await CacaoSync.submit({changeId,entity:tableName,recordId:editing?.id||recordId,expected:editing?.updated_at||null,payload:{...values,owner_id:owner}}):{status:'synced',record:await result((editing?db.from(tableName).update(values).eq('id',editing.id).eq('updated_at',editing.updated_at):db.from(tableName).insert({...values,owner_id:owner})).select().maybeSingle())};
        if(response.status==='queued'){
          editing=null;editingId=null;recordId=crypto.randomUUID();changeId=crypto.randomUUID();consentAt=null;event.target.reset();el('owner_id').value=currentAccount.user.id;
          message('Profile saved in the encrypted queue. It will retry while connected and unlocked.'+(documentFile?.size?' Attach the document after the profile confirms.':''));return;
        }
        const saved=response.record;
        if (!saved) throw new Error('This record changed. Refresh and review before saving again.');
        recordSaved=true;editing=saved;
        if(isFarmer&&documentFile?.size){
          const documentPath=await upload(documentFile,owner,true);
          await result(db.from('farmer_documents').insert({farmer_id:saved.id,owner_id:owner,path:documentPath,label:documentFile.name.slice(0,200)}));
        }
        loadForm(saved);editingId=saved.id;changeId=crypto.randomUUID();consentAt=null;await refresh();message('Record saved. ' + (isFarmer ? 'Registration status: ' + saved.registration_status : ''));
      } catch(error) { message((recordSaved?'The profile was saved, but a follow-up document operation failed. ':'')+error.message+(path&&!recordSaved?' The uploaded file may remain in private storage.':''),true); }
      finally {busy(button,false);}
    });
    if(isFarmer){
      const checkDuplicates=()=>{
        if(!window.CacaoIntegrity)return;
        const candidates=CacaoIntegrity.duplicates(state.rows,formValues(el('record-form')),editing?.id);
        el('duplicate-notice').textContent=candidates.length?candidates.length+' similar authorized farmer record(s) found. Search the directory before creating a new profile.':'';
      };
      el('record-form').addEventListener('input',checkDuplicates);
      const draftKey=()=> 'farmer-profile-'+currentAccount.user.id+'-'+(editing?.id||'new');
      el('save-profile-draft').addEventListener('click',async()=>{
        try{
          const passphrase=prompt('Choose a passphrase of at least 12 characters. Photos must be selected again when restoring.');if(!passphrase)return;
          await CacaoDrafts.save(draftKey(),{values:formValues(el('record-form')),editing},passphrase);message('Encrypted farmer draft saved on this device.');
        }catch(error){message(error.message,true);}
      });
      el('restore-profile-draft').addEventListener('click',async()=>{
        try{
          const passphrase=prompt('Enter the passphrase for this farmer draft.');if(!passphrase)return;
          const draft=await CacaoDrafts.restore(draftKey(),passphrase);
          if(!confirm('Replace the current form with this saved device draft?'))return;
          editing=draft.editing;el('record-form').reset();
          for(const [key,value]of Object.entries(draft.values)){
            const control=el('record-form').elements.namedItem(key);
            if(control&&control.type!=='checkbox'&&control.type!=='file')control.value=value??'';
          }
          message('Draft restored. Review the information and consent, then save when connected.');
        }catch(error){message(error.message,true);}
      });
      el('delete-profile-draft').addEventListener('click',async()=>{
        try{if(confirm('Delete the encrypted draft for this farmer form?')){await CacaoDrafts.remove(draftKey());message('Farmer draft deleted.');}}catch(error){message(error.message,true);}
      });
    }
    await refresh();
  }

  async function inventory() {
    farms=await listPlantations();
    if(window.CacaoSync)farms=await CacaoSync.recordsForPicker('plantations',farms);
    let recordId=crypto.randomUUID(),changeId=crypto.randomUUID();
    setOptions('plantation_id',farms);
    const requestedFarm = new URLSearchParams(location.search).get('plantation');
    if (farms.some(farm => farm.id === requestedFarm)) el('plantation_id').value = requestedFarm;
    const columns=[{value:row=>farms.find(f=>f.id===row.plantation_id)?.name || row.plantation_id},{key:'inventory_date'},{key:'total_trees'},{key:'productive'},{key:'dead'},{key:'variety'}];
    const render=()=>table(state.rows,columns);
    const refresh=async()=>{state.rows=await listAll('cacao_tree_inventories');state.rows.sort((a,b)=>b.inventory_date.localeCompare(a.inventory_date));render();};
    bindTable(render);
    el('refresh-records').addEventListener('click',()=>refresh().catch(error=>message(error.message,true)));
    el('record-form').addEventListener('submit',async event=>{
      event.preventDefault();busy(el('save-record'),true);
      try {
        const values=formValues(event.target);const farm=farms.find(f=>f.id===values.plantation_id);
        if (!farm) throw new Error('Select a plantation.');
        for (const key of ['seedling','young','mature','productive','non_productive','dead']) if (!Number.isSafeInteger(values[key])||values[key]<0) throw new Error('Tree counts must be non-negative whole numbers.');
        if(values.productive+values.non_productive!==values.mature)throw new Error('Productive plus non-productive trees must equal mature trees.');
        if(values.inventory_date>new Date().toISOString().slice(0,10))throw new Error('Inventory date cannot be in the future.');
        const response=window.CacaoSync?await CacaoSync.submit({changeId,entity:'cacao_tree_inventories',recordId,payload:{...values,owner_id:farm.owner_id}}):{status:'synced',record:await result(db.from('cacao_tree_inventories').insert({...values,owner_id:farm.owner_id,recorded_by:currentAccount.user.id}))};
        recordId=crypto.randomUUID();changeId=crypto.randomUUID();event.target.reset();if(response.status==='synced')await refresh();message(response.status==='queued'?'Inventory saved in the encrypted queue.':'Inventory recorded. History is preserved; the latest inventory updates the plantation total.');
      }catch(error){message(error.message,true);}finally{busy(el('save-record'),false);}
    });
    await refresh();
  }

  async function assignments() {
    farms=await listPlantations();records=await listAll('workers');
    if(window.CacaoSync){farms=await CacaoSync.recordsForPicker('plantations',farms);records=await CacaoSync.recordsForPicker('workers',records);}
    let recordId=crypto.randomUUID(),changeId=crypto.randomUUID();
    setOptions('worker_id',records,'id','full_name');setOptions('plantation_id',farms);
    if(!staff())el('editor-panel').classList.add('hidden');
    const columns=[{value:r=>records.find(w=>w.id===r.worker_id)?.full_name||r.worker_id},{value:r=>farms.find(f=>f.id===r.plantation_id)?.name||r.plantation_id},{key:'assigned_on'},{key:'task_description'}];
    const render=()=>table(state.rows,columns);
    const refresh=async()=>{state.rows=await listAll('worker_assignments');render();};bindTable(render);
    el('refresh-records').addEventListener('click',()=>refresh().catch(error=>message(error.message,true)));
    el('record-form').addEventListener('submit',async event=>{
      event.preventDefault();busy(el('save-record'),true);
      try{
        const values=formValues(event.target),farm=farms.find(f=>f.id===values.plantation_id),worker=records.find(w=>w.id===values.worker_id);
        if(!farm||!worker||farm.owner_id!==worker.owner_id)throw new Error('Worker and plantation must belong to the same farmer account.');
        const response=window.CacaoSync?await CacaoSync.submit({changeId,entity:'worker_assignments',recordId,payload:{...values,owner_id:farm.owner_id}}):{status:'synced',record:await result(db.from('worker_assignments').insert({...values,owner_id:farm.owner_id}))};
        recordId=crypto.randomUUID();changeId=crypto.randomUUID();event.target.reset();if(response.status==='synced')await refresh();message(response.status==='queued'?'Assignment saved in the encrypted queue.':'Worker assignment saved.');
      }catch(error){message(error.message,true);}finally{busy(el('save-record'),false);}
    });await refresh();
  }

  function chart(id,type,labels,data,label) {
    if(!window.Chart) { if(el('chart-notice'))el('chart-notice').textContent='Charts are unavailable. Statistics and records remain visible.'; return; }
    state.charts.push(new Chart(el(id),{type,data:{labels,datasets:[{label,data,backgroundColor:['#287a4b','#754c32','#9fba85','#c3a561','#173d2b'],borderColor:'#287a4b',tension:.25}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:type==='doughnut'}},scales:type==='doughnut'?{}:{y:{beginAtZero:true}}}}));
  }
  function group(rows,key,value=()=>1) {
    const counts=new Map();for(const row of rows){const label=key(row)||'Unspecified';counts.set(label,(counts.get(label)||0)+Number(value(row)||0));}return counts;
  }
  async function dashboard() {
    const [farmers,plantations,workers,inventory,activity,harvests,gpsSessions]=await Promise.all(['farmers','plantations','workers','cacao_tree_inventories','activity_logs','harvests','gps_tracking_sessions'].map(t=>t==='workers'&&!staff()?[]:listAll(t)));
    await window.CacaoWorkflow?.dashboard({farmers,plantations});
    const area=plantations.reduce((sum,farm)=>sum+Number(farm.area_sqm||0),0);
    const metrics={'farmers':farmers.length,'farms':plantations.length,'trees':plantations.reduce((s,f)=>s+Number(f.tree_count),0),'sqm':number(area),'ha':(area/10000).toFixed(4),'workers':workers.length,'active':plantations.filter(f=>f.status==='active').length,'pending':farmers.filter(f=>f.registration_status==='pending').length};
    for(const [key,value] of Object.entries(metrics))if(el('stat-'+key))el('stat-'+key).textContent=typeof value==='number'?number(value):value;
    el('stat-dry').textContent=number(harvests.reduce((sum,row)=>sum+Number(row.dry_bean_kg),0));
    el('stat-wet').textContent=number(harvests.reduce((sum,row)=>sum+Number(row.wet_bean_kg),0));
    el('stat-pending-maps').textContent=number(plantations.filter(row=>row.verification_status==='pending').length);
    const monthlyProduction=group(harvests,row=>row.harvest_date.slice(0,7),row=>row.dry_bean_kg);
    const production=[...monthlyProduction].sort((a,b)=>a[0].localeCompare(b[0]));
    chart('production-overview-chart','bar',production.map(row=>row[0]),production.map(row=>row[1]),'Dry beans harvested (kg)');
    const gpsList=el('recent-gps');gpsList.replaceChildren();
    for(const session of gpsSessions.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,5))gpsList.append(text('li',(plantations.find(farm=>farm.id===session.plantation_id)?.name||'Plantation')+' · revision '+(session.boundary_revision||'legacy')+' · '+dateTime(session.created_at)));
    if(!gpsSessions.length)gpsList.append(text('li','No saved GPS mapping sessions.'));
    const registrations=group(farmers,f=>f.created_at.slice(0,7));const monthly=[...registrations].sort((a,b)=>a[0].localeCompare(b[0]));
    chart('registration-chart','bar',monthly.map(v=>v[0]),monthly.map(v=>v[1]),'Farmer registrations');
    const barangays=group(plantations,f=>f.barangay);
    chart('distribution-chart','doughnut',[...barangays.keys()],[...barangays.values()],'Plantations');
    const latest=new Map();inventory.sort((a,b)=>a.inventory_date.localeCompare(b.inventory_date)||a.created_at.localeCompare(b.created_at));
    const trend=new Map();for(const entry of inventory){latest.set(entry.plantation_id,entry.total_trees);trend.set(entry.inventory_date,[...latest.values()].reduce((s,v)=>s+v,0));}
    chart('tree-chart','line',[...trend.keys()],[...trend.values()],'Latest known inventory total over time');
    const list=el('recent-activity');list.replaceChildren();
    const recent=activity.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,6);
    for(const row of recent)list.append(text('li',row.action+' · '+(row.record_type||'record')+' · '+dateTime(row.created_at)));
    if(!recent.length)list.append(text('li','No activity recorded yet.'));
    const body=el('barangay-body');for(const [name,count] of barangays){const tr=document.createElement('tr');tr.append(text('td',name),text('td',count),text('td',humanArea(plantations.filter(f=>f.barangay===name).reduce((s,f)=>s+Number(f.area_sqm),0))));body.append(tr);}
    if(!barangays.size){const td=text('td','No plantations recorded.');td.colSpan=3;const tr=document.createElement('tr');tr.append(td);body.append(tr);}
    if(drawMap(plantations,'dashboard-map'))message('Overview updated from records available to your account.');
  }
  function drawMap(plantations,id='atlas-map') {
    if(!window.L){if(el(id))el(id).textContent='Map library unavailable. Check your internet connection.';message('Map library unavailable. Statistics and records remain available; check your connection to load maps.',true);return false;}
    if(!state.map){
      state.map=L.map(id).setView([6.704,121.972],11);L.control.scale().addTo(state.map);
      const settings=window.CACAO_MAP;
      const streets=L.tileLayer(settings.tiles,{attribution:settings.attribution,maxZoom:settings.maxZoom}).addTo(state.map);
      const layers={'Street map':streets};
      if(settings.imagery?.tiles)layers['Configured imagery']=L.tileLayer(settings.imagery.tiles,{attribution:settings.imagery.attribution,maxZoom:settings.imagery.maxZoom||19});
      L.control.layers(layers).addTo(state.map);state.polygons=L.featureGroup().addTo(state.map);
    }
    state.polygons.clearLayers();
    const colors={active:'#287a4b',inactive:'#6e7e76',rehabilitation:'#a57b24'};
    for(const farm of plantations){
      if(farm.boundary?.type!=='Polygon')continue;
      try{
        const layer=L.geoJSON(farm.boundary,{style:{color:colors[farm.status]||'#287a4b',weight:2,fillOpacity:.2}});
        const popup=document.createElement('div');popup.append(text('strong',farm.name),text('p',farm.farmer_name),text('p',humanArea(farm.area_sqm)+' · '+number(farm.tree_count)+' trees · '+farm.status));
        layer.bindPopup(popup);state.polygons.addLayer(layer);
        const center=layer.getBounds().getCenter();const marker=L.circleMarker(center,{radius:5,color:colors[farm.status]||'#287a4b'}).bindPopup(popup.cloneNode(true));state.polygons.addLayer(marker);
      }catch(error){console.error('Invalid stored boundary',farm.id,error);}
    }
    if(state.polygons.getLayers().length)state.map.fitBounds(state.polygons.getBounds(),{padding:[24,24],maxZoom:16});
    setTimeout(()=>state.map.invalidateSize(),100);
    return true;
  }
  async function atlas() {
    farms=await listPlantations();state.rows=farms;toolbar(farms);
    setOptions('farmer-filter',[...new Map(farms.map(f=>[f.farmer_id||f.farmer_name,{id:f.farmer_id||f.farmer_name,name:f.farmer_name}])).values()],'id','name','All farmers');
    const render=()=>{
      const selected=el('farmer-filter').value;
      const matches=filtered().filter(f=>!selected||(f.farmer_id||f.farmer_name)===selected);
      drawMap(matches);el('map-count').textContent=matches.length+' authorized plantations';
    };
    bindTable(render);el('farmer-filter').addEventListener('change',render);el('fit-map').addEventListener('click',render);render();
  }

  const reportDefinitions={
    farmers:{table:'farmers',columns:['full_name','barangay','municipality','province','registration_status','created_at']},
    plantations:{table:'plantations',columns:['name','farmer_name','barangay','tree_count','area_sqm','status','verification_status','created_at']},
    trees:{table:'cacao_tree_inventories',columns:['plantation_id','inventory_date','seedling','young','mature','productive','non_productive','dead','total_trees']},
    workers:{table:'workers',columns:['full_name','position','employment_type','employment_status','hired_on','created_at']},
    barangay:{table:'plantations',columns:['barangay','plantations','trees','area_sqm','area_ha']},
    status:{table:'plantations',columns:['status','plantations','trees','area_sqm','area_ha']},
    annual:{table:'plantations',columns:['registration_year','plantations','trees','area_sqm','area_ha']},
    distribution:{table:'farmers',columns:['barangay','farmers','approved','pending']}
  };
  let reportColumns=[];
  function reportRows() {
    const matches=filtered(records);
    const kind=el('report-type').value;
    if(!['barangay','status','annual','distribution'].includes(kind))return matches;
    if(kind==='distribution'){
      const groups=new Map();for(const row of matches){const key=row.barangay||'Unspecified',item=groups.get(key)||{barangay:key,farmers:0,approved:0,pending:0};item.farmers++;if(row.registration_status==='approved')item.approved++;if(row.registration_status==='pending')item.pending++;groups.set(key,item);}return [...groups.values()];
    }
    const groupKey=kind==='status'?'status':kind==='annual'?'registration_year':'barangay';
    const groups=new Map();for(const row of matches){const key=kind==='annual'?row.created_at.slice(0,4):(row[groupKey]||'Unspecified');const item=groups.get(key)||{[groupKey]:key,plantations:0,trees:0,area_sqm:0};item.plantations++;item.trees+=Number(row.tree_count);item.area_sqm+=Number(row.area_sqm);groups.set(key,item);}
    return [...groups.values()].map(row=>({...row,area_ha:row.area_sqm/10000}));
  }
  function csvValue(value) {
    let valueText=String(value??'');if(/^[\s]*[=+@-]/.test(valueText))valueText="'"+valueText;
    return '"'+valueText.replaceAll('"','""')+'"';
  }
  async function reports() {
    const render=()=>{
      const rows=reportRows();state.rows=rows;
      const tableHead=el('records-head');tableHead.replaceChildren(...reportColumns.map(c=>text('th',c.replaceAll('_',' '))));
      // Report rows are already filtered before barangay aggregation.
      const body=el('records-body');body.replaceChildren();
      for(const row of rows){const tr=document.createElement('tr');for(const key of reportColumns)tr.append(text('td',row[key]));body.append(tr);}
      if(!rows.length){const cell=text('td','No records match the selected filters.');cell.colSpan=reportColumns.length;const tr=document.createElement('tr');tr.append(cell);body.append(tr);}
      el('report-summary').textContent=rows.length+' rows · Generated '+dateTime(new Date().toISOString())+' (Asia/Manila)';
    };
    async function load(){const definition=reportDefinitions[el('report-type').value];records=await listAll(definition.table);reportColumns=definition.columns;toolbar(records);render();}
    for(const id of ['search','barangay-filter','date-from','date-to'])el(id).addEventListener(id==='search'?'input':'change',render);
    el('report-type').addEventListener('change',()=>load().catch(e=>message(e.message,true)));
    el('export-csv').addEventListener('click',()=>{
      const rows=reportRows();const csv='\uFEFF'+[reportColumns,...rows.map(row=>reportColumns.map(key=>row[key]))].map(row=>row.map(csvValue).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='cacao-'+el('report-type').value+'-'+new Date().toISOString().slice(0,10)+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    el('print-report').addEventListener('click',()=>{render();window.print();});await load();
  }
  async function audit() {
    state.rows=(await listAll('activity_logs')).sort((a,b)=>b.created_at.localeCompare(a.created_at));
    const render=()=>table(state.rows,[{value:r=>dateTime(r.created_at)},{key:'action'},{key:'record_type'},{key:'record_id'},{key:'actor_id'},{value:r=>(r.details?.changed_fields||[]).join(', ')}]);toolbar(state.rows);bindTable(render);render();
  }
  async function accounts() {
    if(currentAccount.profile.role!=='super_admin')throw new Error('Only the super administrator can manage account permissions.');
    users=await listAll('profiles');state.rows=users;
    const render=()=>table(state.rows,[{key:'display_name'},{key:'id'},{key:'role'},{key:'account_status'}],row=>[{label:'Manage',run:()=>{
      el('target-user').value=row.id;el('new-role').value=row.role;el('new-status').value=row.account_status;
      el('access-form').scrollIntoView({block:'start'});
    }}]);bindTable(render);render();
    setOptions('target-user',users,'id','display_name');setOptions('staff-id',users.filter(u=>['admin','field'].includes(u.role)),'id','display_name');setOptions('farmer-owner',users,'id','display_name');
    const assignmentsList=el('staff-assignment-list');
    async function refreshAssignments(){
      const assigned=await listAllAssignments();assignmentsList.replaceChildren();
      for(const assignment of assigned){const li=document.createElement('li');li.append(text('span',(users.find(u=>u.id===assignment.staff_id)?.display_name||assignment.staff_id)+' → '+(users.find(u=>u.id===assignment.farmer_owner_id)?.display_name||assignment.farmer_owner_id)));
        const remove=text('button','Remove','text-btn');remove.type='button';remove.addEventListener('click',async()=>{try{if(!confirm('Remove staff access to this farmer account?'))return;await result(db.from('staff_farmer_assignments').delete().eq('staff_id',assignment.staff_id).eq('farmer_owner_id',assignment.farmer_owner_id));await refreshAssignments();}catch(error){message(error.message,true);}});li.append(remove);assignmentsList.append(li);}
      if(!assigned.length)assignmentsList.append(text('li','No staff assignments yet.'));
    }
    async function listAllAssignments(){return result(db.from('staff_farmer_assignments').select('*'));}
    el('access-form').addEventListener('submit',async event=>{
      event.preventDefault();const button=event.submitter;busy(button,true);
      try{if(!confirm('Apply these role and account status changes?'))return;await result(db.rpc('set_account_access',{target:el('target-user').value,new_role:el('new-role').value,new_status:el('new-status').value}));message('Account access updated. The user should sign in again.');users=await listAll('profiles');state.rows=users;render();}
      catch(error){message(error.message,true);}finally{busy(button,false);}
    });
    el('staff-form').addEventListener('submit',async event=>{
      event.preventDefault();busy(event.submitter,true);
      try{await result(db.from('staff_farmer_assignments').upsert({staff_id:el('staff-id').value,farmer_owner_id:el('farmer-owner').value},{onConflict:'staff_id,farmer_owner_id'}));await refreshAssignments();message('Staff assignment saved.');}catch(error){message(error.message,true);}finally{busy(event.submitter,false);}
    });
    el('invite-form').addEventListener('submit',async event=>{
      event.preventDefault();busy(event.submitter,true);
      try{await result(db.functions.invoke('invite-team',{body:{email:el('invite-email').value.trim(),role:el('invite-role').value,redirectTo:new URL('../reset-password.html',location.href).href}}));message('Invitation sent. Refresh Users after the account is created.');}catch(error){message('Invitation failed. Ensure invite-team is deployed and its allowed origin is configured. '+error.message,true);}finally{busy(event.submitter,false);}
    });await refreshAssignments();
  }
  async function start(feature) {
    try {
      message('Loading authorized records…');
      if(!await requireSession())return;
      const modules={farmers:()=>registry('farmers'),workers:()=>registry('workers'),trees:inventory,assignments,dashboard,atlas,reports,audit,users:accounts};
      await modules[feature]();
      if(el('page-status').textContent==='Loading authorized records…')message('');
    }catch(error){message(error.message,true);}
  }
  return {start,upload,viewPhoto,number,dateTime,csvValue,drawMap};
})();
