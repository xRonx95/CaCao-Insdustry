// Encrypted, account-scoped outbox. Keys stay in memory; server receipts make retries idempotent.
window.CacaoSync = (() => {
  const encoder=new TextEncoder(),decoder=new TextDecoder();
  let actor=null,key=null,running=false,retryTimer=null,unlockWaiters=[];
  const activeStates=['pending','conflict','attention','blocked'];
  const account=()=>typeof currentAccount!=='undefined'?currentAccount:null;
  async function open(){return new Promise((resolve,reject)=>{
    const request=indexedDB.open('cacao-field-outbox',1);
    request.onupgradeneeded=()=>{for(const name of ['vaults','queue','snapshots'])request.result.createObjectStore(name,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });}
  async function storage(store,mode,callback){const database=await open();return new Promise((resolve,reject)=>{
    const tx=database.transaction(store,mode),request=callback(tx.objectStore(store));
    tx.oncomplete=()=>{database.close();resolve(request.result);};tx.onerror=()=>{database.close();reject(tx.error);};tx.onabort=()=>{database.close();reject(tx.error||new Error('Local storage transaction aborted.'));};
  });}
  async function derive(passphrase,salt){
    if(passphrase.length<12)throw new Error('Use at least 12 characters for your field-data passphrase.');
    const material=await crypto.subtle.importKey('raw',encoder.encode(passphrase),'PBKDF2',false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function seal(id,value,withKey=key,withActor=actor){
    if(!withKey)throw new Error('Unlock field data first.');
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(withActor+':'+id)},withKey,encoder.encode(JSON.stringify(value)));
    return {iv,encrypted};
  }
  async function decrypt(record,withKey=key,withActor=actor){
    if(!withKey||record.actor!==withActor)throw new Error('This field record is locked or belongs to another account.');
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:encoder.encode(withActor+':'+record.id)},withKey,record.encrypted);
    return JSON.parse(decoder.decode(plain));
  }
  function emit(){window.dispatchEvent(new CustomEvent('cacao-sync-change'));refreshBadge().catch(()=>{});}
  function lock(){key=null;actor=null;clearTimeout(retryTimer);emit();}
  async function unlock(passphrase){
    const user=account()?.user;if(!user)throw new Error('Open a protected workspace with your account first.');
    const actorId=user.id;let vault=await storage('vaults','readonly',store=>store.get(actorId));
    const salt=vault?.salt||crypto.getRandomValues(new Uint8Array(16));const candidate=await derive(passphrase,salt);
    if(vault){try{const check=await decrypt({...vault,actor:actorId},candidate,actorId);if(check.check!=='cacao-field-v1')throw new Error();}catch{throw new Error('Incorrect field-data passphrase. Existing encrypted records were not changed.');}}
    else{vault={id:actorId,actor:actorId,salt,...await seal(actorId,{check:'cacao-field-v1'},candidate,actorId)};await storage('vaults','readwrite',store=>store.put(vault));}
    actor=actorId;key=candidate;emit();if(navigator.onLine)flush().catch(()=>{});
  }
  function unlocked(){return !!key&&actor===account()?.user?.id;}
  async function ensureUnlocked(){
    if(unlocked())return;
    const dialog=document.getElementById('field-unlock-dialog');
    if(!dialog)throw new Error('Open Sync & recovery to unlock field data before saving.');
    return new Promise((resolve,reject)=>{unlockWaiters.push({resolve,reject});if(!dialog.open)dialog.showModal();});
  }
  async function envelopes(){const id=account()?.user?.id;if(!id)return [];return (await storage('queue','readonly',store=>store.getAll())).filter(row=>row.actor===id).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));}
  function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
  function classify(error){
    if(error.code==='40P01')return 'pending';
    if(['40001','23505','P0002'].includes(error.code))return 'conflict';
    if(['42501','PGRST301'].includes(error.code))return 'blocked';
    if(!error.code||/fetch|network|timeout|aborted/i.test(error.message||''))return 'pending';
    return 'attention';
  }
  async function request(change){
    const {data,error}=await db.rpc('apply_field_change',{
      change_id:change.changeId,entity:change.entity,record_id:change.recordId,operation:change.operation,payload:change.payload,
      expected_revision:change.revision??null,expected_updated_at:change.expected??null
    });
    if(error)throw error;if(!data?.confirmed||!data.record)throw new Error('The server did not confirm this submission. It remains queued.');
    return data;
  }
  async function cache(table,rows){if(!unlocked())return;const id=actor+':'+table;
    // Replace metadata only after encryption succeeds; no plaintext rows are stored.
    const encrypted=await seal(id,rows);await storage('snapshots','readwrite',store=>store.put({id,actor,table,savedAt:new Date().toISOString(),...encrypted}));
  }
  async function cached(table){await ensureUnlocked();const row=await storage('snapshots','readonly',store=>store.get(actor+':'+table));if(!row?.encrypted)throw new Error('No downloaded field records for '+table+'. Prepare field records while connected.');return decrypt(row);}
  async function writeConfirmation(envelope,change,response){
    if(!unlocked()||envelope.actor!==actor)return;
    const encrypted=await seal(envelope.id,{change,record:response.record});
    await storage('queue','readwrite',store=>store.put({...envelope,...encrypted,status:'synced',confirmedAt:new Date().toISOString(),errorCode:null}));
    try{const rows=await cached(change.entity);const index=rows.findIndex(row=>row.id===response.record.id);if(index<0)rows.push(response.record);else rows[index]=response.record;await cache(change.entity,rows);}catch{}
  }
  async function flush(){
    if(running||!unlocked()||!navigator.onLine)return;running=true;clearTimeout(retryTimer);
    try{
      // Recheck active account and current permissions before sending queued records.
      const access=await accountAccess();if(access.user.id!==actor)throw new Error('The active account changed. Unlock this account again.');
      const queue=await envelopes();
      for(const envelope of queue){
        if(envelope.status!=='pending'||envelope.retryAt>Date.now()||!unlocked())continue;
        const {change}=await decrypt(envelope);
        let dependencyPending=false;
        for(const relation of ['farmer_id','plantation_id','worker_id','pest_report_id'])if(change.payload[relation]){
          const dependency=queue.find(item=>item.recordId===change.payload[relation]&&activeStates.includes(item.status));if(dependency)dependencyPending=true;
        }
        if(dependencyPending)continue;
        try{
          const response=await request(change);await writeConfirmation(envelope,change,response);envelope.status='synced';emit();
        }catch(error){
          const status=classify(error),attempts=(envelope.attempts||0)+1;
          await storage('queue','readwrite',store=>store.put({...envelope,status,attempts,errorCode:error.code||'NETWORK',retryAt:Date.now()+Math.min(60000,3000*2**Math.min(attempts-1,5))}));
          envelope.status=status;emit();
        }
      }
    }catch(error){const badge=document.getElementById('field-sync-status');if(badge)badge.textContent='Sync paused: check your connection and account access.';}
    finally{
      running=false;
      const pending=(await envelopes()).filter(row=>row.status==='pending');
      if(pending.length&&unlocked()&&navigator.onLine)retryTimer=setTimeout(()=>flush().catch(()=>{}),Math.max(3000,Math.min(...pending.map(row=>(row.retryAt||Date.now())-Date.now()))));
    }
  }
  async function submit(command){
    await ensureUnlocked();
    const change=JSON.parse(JSON.stringify({...command,changeId:command.changeId||crypto.randomUUID(),recordId:command.recordId||crypto.randomUUID(),operation:command.operation||((command.expected||command.revision!=null)?'update':'create')}));
    const previous=await storage('queue','readonly',store=>store.get(change.changeId));
    if(previous){
      if(previous.actor!==actor)throw new Error('Submission identifier belongs to another account.');
      const stored=await decrypt(previous);
      if(canonical(stored.change)!==canonical(change))throw new Error('This submission already has an unresolved outcome. Open Sync & recovery before changing and resubmitting it.');
      if(previous.status==='synced')return {status:'synced',record:stored.record};
      if(previous.status!=='pending')throw new Error('This record needs review in Sync & recovery.');
    }else{
      const overlapping=(await envelopes()).find(row=>row.recordId===change.recordId&&activeStates.includes(row.status));
      if(overlapping)throw new Error('An earlier change to this record is still queued. Review it in Sync & recovery first.');
      const encrypted=await seal(change.changeId,{change});
      await storage('queue','readwrite',store=>store.put({id:change.changeId,actor,entity:change.entity,recordId:change.recordId,status:'pending',attempts:0,retryAt:0,createdAt:new Date().toISOString(),...encrypted}));
    }
    emit();if(navigator.onLine)await flush();
    const envelope=await storage('queue','readonly',store=>store.get(change.changeId));
    if(envelope.status==='synced')return {status:'synced',record:(await decrypt(envelope)).record};
    if(envelope.status!=='pending')throw new Error('The server requires review of this submission. It remains encrypted in Sync & recovery ('+envelope.status+').');
    return {status:'queued',record:{...change.payload,id:change.recordId,_offline_pending:true}};
  }
  async function recordsForPicker(table,confirmed){
    if(!unlocked())return confirmed;
    const rows=[...confirmed];for(const envelope of await envelopes())if(envelope.entity===table&&activeStates.includes(envelope.status)){
      const {change}=await decrypt(envelope);if(change.operation==='create'&&!rows.some(row=>row.id===change.recordId))rows.push({...change.payload,id:change.recordId,_offline_pending:true});
    }return rows;
  }
  async function inspect(id){await ensureUnlocked();const row=await storage('queue','readonly',store=>store.get(id));if(!row||row.actor!==actor)throw new Error('Queued record unavailable.');return {metadata:row,...await decrypt(row)};}
  async function revise(id,payload,server){
    const original=await inspect(id);if(!activeStates.includes(original.metadata.status))throw new Error('This change is no longer awaiting review.');
    if(original.change.operation==='update'&&!server)throw new Error('Load the current server record before resolving an update conflict.');
    const change={...original.change,payload,changeId:crypto.randomUUID(),expected:server?.updated_at||original.change.expected,revision:server?.revision??original.change.revision};
    // Preserve the old encrypted version as history. Never replace it with an unconfirmed edit.
    const encrypted=await seal(change.changeId,{change});
    await storage('queue','readwrite',store=>{
      store.put({...original.metadata,status:'superseded',supersededBy:change.changeId});
      return store.put({id:change.changeId,actor,entity:change.entity,recordId:change.recordId,status:'pending',attempts:0,retryAt:0,createdAt:new Date().toISOString(),...encrypted});
    });
    return submit(change);
  }
  async function archive(id){const item=await inspect(id);if(item.metadata.status==='synced')throw new Error('Use Remove confirmed receipts for synchronized entries.');await storage('queue','readwrite',store=>store.put({...item.metadata,status:'archived'}));emit();}
  async function retry(){for(const row of await envelopes())if(['pending','blocked','attention'].includes(row.status))await storage('queue','readwrite',store=>store.put({...row,status:'pending',retryAt:0}));emit();await flush();}
  async function clearConfirmed(){for(const row of await envelopes())if(row.status==='synced')await storage('queue','readwrite',store=>store.delete(row.id));emit();}
  async function prepare(){await ensureUnlocked();if(!navigator.onLine)throw new Error('Connect before preparing field records.');
    for(const table of ['farmers','plantations','workers','worker_assignments','pest_reports','cacao_tree_inventories','harvests','pest_treatments','pest_inspections','plantation_tasks','maintenance_records','worker_attendance','tree_events','cacao_trees','activity_logs','gps_tracking_sessions'])await cache(table,await listAll(table));
    if(account().profile.role==='super_admin')await cache('profiles',await listAll('profiles'));
    const {data,error}=await db.from('staff_farmer_assignments').select('*');if(error)throw error;await cache('staff_farmer_assignments',data);emit();
    if(window.CacaoOffline)await CacaoOffline.prepareLibraries();
  }
  async function refreshBadge(){const badge=document.getElementById('field-sync-status');if(!badge)return;const queued=(await envelopes()).filter(row=>activeStates.includes(row.status));badge.textContent=(navigator.onLine?'Online':'Offline')+' · '+queued.length+' queued · '+(unlocked()?'unlocked':'locked');}
  function accountReady(){if(actor&&actor!==account()?.user?.id)lock();refreshBadge().catch(()=>{});}
  const form=document.getElementById('field-unlock-form'),dialog=document.getElementById('field-unlock-dialog');
  form?.addEventListener('submit',async event=>{
    event.preventDefault();const button=event.submitter||form.querySelector('button[type="submit"]');if(button)button.disabled=true;
    try{await unlock(document.getElementById('field-passphrase').value);form.reset();dialog.close();const waiting=unlockWaiters;unlockWaiters=[];waiting.forEach(waiter=>waiter.resolve());}
    catch(error){document.getElementById('field-unlock-error').textContent=error.message;}finally{if(button)button.disabled=false;}
  });
  function cancelUnlock(){const waiting=unlockWaiters;unlockWaiters=[];waiting.forEach(waiter=>waiter.reject(new Error('Field data remains locked. The form has not been submitted.')));}
  dialog?.addEventListener('cancel',cancelUnlock);document.getElementById('field-unlock-cancel')?.addEventListener('click',()=>{dialog.close();cancelUnlock();});
  document.getElementById('unlock-field-data')?.addEventListener('click',()=>ensureUnlocked().catch(()=>{}));
  window.addEventListener('online',()=>{emit();flush().catch(()=>{});});window.addEventListener('offline',emit);
  return {unlock,ensureUnlocked,unlocked,lock,submit,flush,retry,cache,cached,prepare,recordsForPicker,inspect,revise,archive,clearConfirmed,envelopes,accountReady,classify,canonical};
})();
