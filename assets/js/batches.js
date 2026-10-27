// Online commands are validated atomically by migration 010; no offline success is inferred.
window.CacaoBatches=(()=>{
  const stages=['harvested','fermenting','drying','quality_check','stored','sold'];
  const labels={harvested:'Harvested',fermenting:'Fermentation',drying:'Drying',quality_check:'Quality check',stored:'Storage',sold:'Sold'};
  const next=batch=>!stages.includes(batch.stage)?[]:batch.stage==='quality_check'?['quality_check',...(batch.quality_result==='pass'?['stored']:[])]:batch.stage==='sold'?[]:[stages[stages.indexOf(batch.stage)+1]].filter(Boolean);
  const permitted=(batch,role)=>next(batch).filter(stage=>['admin','super_admin'].includes(role)||(['farmer','field'].includes(role)&&['fermenting','drying'].includes(stage)));
  const decimal=(value,places)=>value!=null&&Number.isFinite(Number(value))&&value!==''&&Math.abs(Number(value)*10**places-Math.round(Number(value)*10**places))<1e-6;
  function validate(payload,batch,harvest,today){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(payload.event_on)||!Number.isFinite(Date.parse(payload.event_on))||new Date(payload.event_on).toISOString().slice(0,10)!==payload.event_on||payload.event_on>today)throw Error('Choose a date that is not in the future.');
    if(!decimal(payload.weight_kg,3)||Number(payload.weight_kg)<=0||Number(payload.weight_kg)>999999999)throw Error('Enter a positive weight in kg, with at most 3 decimal places.');
    if(payload.note.trim().length<3||payload.note.trim().length>2000)throw Error('Write a note between 3 and 2000 characters.');
    if(payload.action==='create'){
      if(!harvest)throw Error('Select a recorded harvest.');
      if(!payload.code.trim()||payload.code.trim().length>60)throw Error('Enter a batch code of up to 60 characters.');
      if(Number(payload.weight_kg)>Number(harvest.wet_bean_kg))throw Error('Batch weight exceeds the harvest wet-bean weight.');
      if(payload.event_on<harvest.harvest_date)throw Error('Batch date cannot precede the harvest.');
    }else{
      if(!batch||!next(batch).includes(payload.stage))throw Error('Choose the next permitted batch stage.');
      if(payload.event_on<batch.stage_on)throw Error('Date cannot precede the previous stage.');
      if(Number(payload.weight_kg)>Number(batch.current_weight_kg))throw Error('Weight cannot increase. Additional beans need a separate batch.');
      if(payload.stage==='quality_check'&&(!['pass','hold','fail'].includes(payload.quality_result)||!decimal(payload.moisture_pct,2)||Number(payload.moisture_pct)<0||Number(payload.moisture_pct)>100))throw Error('Record the quality result and moisture percentage (0–100).');
      if(payload.stage==='sold'&&(!payload.buyer.trim()||!decimal(payload.sale_php,2)||Number(payload.sale_php)<0||Number(payload.sale_php)>999999999999))throw Error('Enter the buyer and total sale amount in PHP.');
      if(payload.stage==='sold'&&Number(payload.weight_kg)!==Number(batch.current_weight_kg))throw Error('Record the whole stored batch weight for this sale. Partial sales are not supported.');
    }
    return payload;
  }
  async function start(){
    const $=id=>document.getElementById(id),node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value??'';return el;};
    const tell=(value,error=false)=>notify('page-status',value,error);
    let farms=[],harvests=[],batches=[],events=[],selected=null,pending=null,busy=false;
    const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const options=(select,items)=>{select.replaceChildren();for(const [value,label] of items){const option=node('option',label);option.value=value;select.append(option);}};
    function formState(){
      const quality=$('batch-stage').value==='quality_check',sale=$('batch-stage').value==='sold';
      $('batch-quality').hidden=!quality;$('batch-sale').hidden=!sale;
      for(const id of ['batch-moisture','batch-quality-result']){$(id).disabled=!quality;$(id).required=quality;}
      for(const id of ['batch-buyer','batch-sale-php']){$(id).disabled=!sale;$(id).required=sale;}
    }
    function choose(batch){
      if(pending){tell('Retry the pending submission before selecting another batch.',true);return;}
      selected=batch;$('batch-detail').hidden=!batch;if(!batch)return;
      $('batch-title').textContent=batch.code+' · '+labels[batch.stage];
      const track=$('batch-stages');track.replaceChildren();
      for(const stage of stages){const li=node('li',labels[stage]);if(stage===batch.stage)li.setAttribute('aria-current','step');track.append(li);}
      $('batch-overview').textContent='Original wet beans: '+batch.allocated_wet_kg+' kg · Current weight: '+batch.current_weight_kg+' kg · Revision '+batch.revision+(batch.quality_result?' · Quality: '+batch.quality_result:'');
      const timeline=$('batch-timeline');timeline.replaceChildren();
      for(const event of events.filter(row=>row.batch_id===batch.id).sort((a,b)=>a.revision-b.revision)){
        const li=node('li');li.append(node('strong',labels[event.stage]+' · '+event.event_on),node('p',event.weight_kg+' kg'+(event.quality_result?' · '+event.quality_result+' · moisture '+event.moisture_pct+'%':'')+(event.buyer?' · Buyer: '+event.buyer+' · PHP '+Number(event.sale_php).toLocaleString():'')+' · '+event.note),node('small','Revision '+event.revision+' · Recorded '+new Date(event.created_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})));timeline.append(li);
      }
      const allowed=permitted(batch,currentAccount.profile.role);$('batch-advance-form').hidden=!allowed.length;
      $('batch-sold-notice').hidden=batch.stage!=='sold';
      document.getElementById('batch-admin-notice')?.remove();
      if(!allowed.length&&batch.stage!=='sold'&&!['admin','super_admin'].includes(currentAccount.profile.role)){const notice=node('p','An administrator must record the quality decision, storage or sale. You can continue viewing batch history.');notice.id='batch-admin-notice';$('batch-advance-form').before(notice);}
      options($('batch-stage'),allowed.map(stage=>[stage,stage==='quality_check'&&batch.stage==='quality_check'?'Repeat quality check':labels[stage]]));
      $('batch-advance-form').reset();$('batch-event-on').value=today();$('batch-event-on').min=batch.stage_on;$('batch-event-on').max=today();$('batch-event-weight').value=batch.current_weight_kg;formState();
    }
    function render(){
      const query=$('batch-search').value.trim().toLowerCase(),filter=$('batch-filter').value;
      const matches=batches.filter(row=>(!filter||row.stage===filter)&&(!query||[row.code,farms.find(f=>f.id===row.plantation_id)?.name].join(' ').toLowerCase().includes(query)));
      const body=$('batch-body');body.replaceChildren();
      for(const batch of matches){const tr=node('tr');for(const value of [batch.code,farms.find(f=>f.id===batch.plantation_id)?.name||'Plantation',labels[batch.stage],batch.current_weight_kg+' kg',batch.stage_on])tr.append(node('td',value));const td=node('td'),button=node('button','Open history');button.type='button';button.className='btn secondary';button.addEventListener('click',()=>choose(batch));td.append(button);tr.append(td);body.append(tr);}
      if(!matches.length){const tr=node('tr'),td=node('td','No matching batches. Create a batch from a harvest with a recorded wet-bean weight.');td.colSpan=6;tr.append(td);body.append(tr);}
      $('batch-count').textContent=matches.length+' batches';
    }
    async function load(){
      const data=await Promise.all(['plantations','harvests','harvest_batches','harvest_batch_events'].map(table=>listAll(table)));
      [farms,harvests,batches,events]=data;
      options($('batch-harvest'),[['','Select a harvest'],...harvests.filter(row=>Number(row.wet_bean_kg)>0).map(row=>[row.id,(farms.find(f=>f.id===row.plantation_id)?.name||'Plantation')+' · '+row.harvest_date+' · '+row.wet_bean_kg+' kg wet beans'])]);
      const noHarvest=!harvests.some(row=>Number(row.wet_bean_kg)>0);$('batch-create-button').disabled=noHarvest;$('batch-harvest-help').textContent=noHarvest?'Record a harvest with a wet-bean weight before creating a batch.':'Choose the harvest this batch came from. Previously allocated weight is checked when saving.';
      render();if(!selected){const requested=new URLSearchParams(location.search).get('batch');selected=batches.find(row=>row.id===requested)||null;}if(selected)choose(batches.find(row=>row.id===selected.id)||null);
    }
    function lockForms(lock){
      for(const form of [$('batch-create-form'),$('batch-advance-form')])for(const control of form.elements)control.disabled=lock;
      if(!lock){formState();$('batch-create-button').disabled=!harvests.some(row=>Number(row.wet_bean_kg)>0);}
    }
    async function submit(command){
      if(command.action==='advance'&&!permitted(selected,currentAccount.profile.role).includes(command.stage))return tell('Only administrators can record quality decisions, storage and sales.',true);
      if(busy)return;if(!navigator.onLine){tell('Connect to save batch records. Nothing has been submitted.',true);return;}
      if(pending&&JSON.stringify(command)!==JSON.stringify(pending.payload)){tell('Retry the original submission before changing its contents.',true);return;}
      pending??={id:crypto.randomUUID(),payload:command};busy=true;lockForms(true);$('batch-retry').hidden=true;
      tell('Saving batch record. Keep this page open…');
      try{
        const {data,error}=await db.rpc('save_harvest_batch',{p_request_id:pending.id,p_payload:pending.payload});
        if(error){if(error.code&&error.code!=='57014'){pending=null;lockForms(false);}throw error;}
        if(!data)throw Error('No server confirmation received. Retry this submission.');
        const wasCreate=command.action==='create';pending=null;selected=data;lockForms(false);if(wasCreate){$('batch-create-form').reset();$('batch-created-on').value=today();}
        try{await load();tell('Batch record saved and confirmed by the server.');}
        catch{tell('Saved and confirmed, but history could not reload. Use Refresh batches before recording another stage.',true);$('batch-advance-form').hidden=true;}
      }catch(error){tell((error.message||'Batch save failed.')+(pending?' Confirmation is uncertain. Retry the same submission; do not enter it again as a new batch.':''),true);$('batch-retry').hidden=!pending;}
      finally{busy=false;}
    }
    try{
      if(!await requireSession())return;
      $('batch-created-on').value=today();$('batch-created-on').max=today();
      options($('batch-filter'),[['','All stages'],...stages.map(stage=>[stage,labels[stage]])]);
      $('batch-search').addEventListener('input',render);$('batch-filter').addEventListener('change',render);$('batch-stage').addEventListener('change',formState);
      $('batch-refresh').addEventListener('click',async()=>{if(pending)return tell('Retry the pending submission first.',true);try{await load();tell('Batch history updated.');}catch(error){tell('Batch history could not load. Previously shown records may be out of date. '+error.message,true);}});
      $('batch-retry').addEventListener('click',()=>pending&&submit(pending.payload));
      $('batch-export').addEventListener('click',()=>{
        if(!selected)return;
        const columns=['batch_code','stage','event_on','weight_kg','moisture_pct','quality_result','buyer','sale_php','note','revision','recorded_at'];
        const rows=events.filter(row=>row.batch_id===selected.id).sort((a,b)=>a.revision-b.revision).map(row=>[selected.code,row.stage,row.event_on,row.weight_kg,row.moisture_pct,row.quality_result,row.buyer,row.sale_php,row.note,row.revision,row.created_at]);
        const csv='\uFEFF'+[columns,...rows].map(row=>row.map(CacaoApp.csvValue).join(',')).join('\r\n');
        const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),anchor=node('a');anchor.href=url;anchor.download='batch-history.csv';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      });
      $('batch-print').addEventListener('click',()=>window.print());
      $('batch-create-form').addEventListener('submit',event=>{event.preventDefault();const payload={action:'create',harvest_id:$('batch-harvest').value,code:$('batch-code').value.trim().toUpperCase(),event_on:$('batch-created-on').value,weight_kg:$('batch-wet-kg').value,note:$('batch-create-note').value.trim()};try{validate(payload,null,harvests.find(h=>h.id===payload.harvest_id),today());submit(payload);}catch(error){tell(error.message,true);}});
      $('batch-advance-form').addEventListener('submit',event=>{event.preventDefault();const stage=$('batch-stage').value,payload={action:'advance',batch_id:selected?.id,expected_revision:selected?.revision,stage,event_on:$('batch-event-on').value,weight_kg:$('batch-event-weight').value,note:$('batch-event-note').value.trim()};if(stage==='quality_check'){payload.moisture_pct=$('batch-moisture').value;payload.quality_result=$('batch-quality-result').value;}if(stage==='sold'){payload.buyer=$('batch-buyer').value.trim();payload.sale_php=$('batch-sale-php').value;}try{validate(payload,selected,null,today());submit(payload);}catch(error){tell(error.message,true);}});
      tell('Loading batch records…');await load();tell('Batch records loaded. Stage changes require a connection.');
    }catch(error){tell('Batch records unavailable. If this feature is new, ask your administrator to apply migration 010 after 001–009. '+error.message,true);$('batch-create-button').disabled=true;}
  }
  return {start,next,permitted,validate,stages};
})();
CacaoBatches.start();
