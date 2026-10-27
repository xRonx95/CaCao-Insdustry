window.CacaoPostharvest=(()=>{
 const kinds={protocol:'Agreed process protocol',fermentation:'Fermentation check',drying:'Drying check',quality:'Quality assessment',handover:'Facility / cooperative handover',cost:'Post-harvest cost'};
 // [field, label, control, options or minimum, maximum, step, optional]
 const fields={
  protocol:[['facility','Cooperative / facility','text'],['reference','Buyer / adviser and protocol reference','text'],['started_at','Actual fermentation start','datetime-local'],['min_hours','Agreed minimum fermentation (hours)','number',.1,1000,.1],['turn_hours','Agreed turning interval (hours; 0 = no reminder)','number',0,1000,.1],['max_moisture','Agreed maximum moisture (%)','number',0,100,.01],['max_defects','Agreed maximum sample defects (%)','number',0,100,.01]],
  fermentation:[['temperature_c','Measured bean temperature (°C)','number',-10,100,.1],['turned','Were the beans turned / mixed?','select',['yes','no']]],
  drying:[['moisture_pct','Measured moisture (%)','number',0,100,.01],['method','Drying method','select',['sun','solar','mechanical','other']],['weather','Conditions','select',['dry','humid','rain','indoor']],['protected','Protected from rain / contamination?','select',['yes','no']]],
  quality:[['moisture_pct','Measured moisture (%)','number',0,100,.01],['sample_beans','Beans in the cut-test sample','number',1,100000,1],['moldy','Moldy beans','number',0,100000,1],['slaty','Slaty beans','number',0,100000,1],['insect_damaged','Insect-damaged beans','number',0,100000,1],['grade','Recorded grade','select',['ungraded','premium','standard','downgraded','rejected']],['assessor','Observer / reviewer and assessment reference','text']],
  handover:[['from_facility','From facility / storage location','text'],['to_facility','To cooperative / facility','text'],['recipient','Recorded recipient name','text']],
  cost:[['category','Cost category','select',['labor','materials','energy','transport','testing','other']],['amount_php','Amount (PHP)','number',0,999999999999,.01]]
 };
 const effective=records=>{const replaced=new Set(records.map(row=>row.supersedes_id).filter(Boolean));return records.filter(row=>!replaced.has(row.id)).sort((a,b)=>(b.observed_at||'').localeCompare(a.observed_at||'')||(b.created_at||'').localeCompare(a.created_at||'')||(b.id||'').localeCompare(a.id||''));};
 const latest=(rows,kind)=>effective(rows).find(row=>row.kind===kind);
 function metrics(batches,records){
  const rows=effective(records),sold=batches.filter(batch=>batch.stage==='sold'),soldIds=new Set(sold.map(batch=>batch.id));
  const sales=sold.reduce((n,b)=>n+Number(b.sale_php||0),0),costs=rows.filter(row=>row.kind==='cost'&&soldIds.has(row.batch_id)).reduce((n,row)=>n+Number(row.detail.amount_php||0),0),soldKg=sold.reduce((n,b)=>n+Number(b.current_weight_kg||0),0);
  const grades=batches.map(batch=>latest(rows.filter(row=>row.batch_id===batch.id),'quality')).filter(row=>row&&row.detail.grade!=='ungraded');
  const assessed=grades.reduce((n,row)=>n+Number(row.weight_snapshot_kg),0),downgraded=grades.filter(row=>['downgraded','rejected'].includes(row.detail.grade)).reduce((n,row)=>n+Number(row.weight_snapshot_kg),0);
  return {sales,costs,margin:sales-costs,soldKg,pricePerKg:soldKg?sales/soldKg:null,costPerKg:soldKg?costs/soldKg:null,soldCount:sold.length,gradedCount:grades.length,assessedKg:assessed,downgradePct:assessed?downgraded*100/assessed:null};
 }
 function checks(batch,records,now=Date.now()){
  const rows=records.filter(row=>row.batch_id===batch.id),protocol=latest(rows,'protocol')?.detail,messages=[];
  if(!protocol)return ['Record a buyer/adviser-agreed protocol before storage.'];
  const start=Date.parse(protocol.started_at),fermentation=latest(effective(rows).filter(row=>row.detail.turned===true),'fermentation');
  if(batch.stage==='fermenting'&&Number.isFinite(start)){
   const elapsed=(now-start)/3600000;
   messages.push(elapsed>=Number(protocol.min_hours)?'Minimum agreed fermentation time reached; quality still needs assessment.':'Fermentation: '+Math.max(0,Number(protocol.min_hours)-elapsed).toFixed(1)+' hours until the agreed minimum.');
   const anchor=fermentation?Date.parse(fermentation.observed_at):start,interval=Number(protocol.turn_hours);
   if(interval>0)messages.push(now>=anchor+interval*3600000?'Turning check is due under the agreed protocol.':'Next turning check: '+new Date(anchor+interval*3600000).toLocaleString('en-PH',{timeZone:'Asia/Manila'}));
  }
  const moisture=effective(rows).find(row=>['drying','quality'].includes(row.kind));
  if(moisture)messages.push(Number(moisture.detail.moisture_pct)>Number(protocol.max_moisture)?'Latest moisture exceeds the agreed target. Continue review before storage.':'Latest recorded moisture is within the agreed target; other quality criteria still apply.');
  const quality=latest(rows,'quality');
  if(quality){const d=quality.detail,defects=(Number(d.moldy)+Number(d.slaty)+Number(d.insect_damaged))*100/Number(d.sample_beans);if(defects>Number(protocol.max_defects))messages.push('Cut-test defects exceed the agreed maximum. Staff review is needed.');if(d.grade==='ungraded')messages.push('Quality observations await an assigned staff grade.');}
  return messages.length?messages:['Record process checks and a staff quality assessment before storage.'];
 }
 function validate(kind,detail,role){
  if(!fields[kind])throw Error('Choose a supported record type.');
  if(kind==='protocol'&&role==='farmer')throw Error('Assigned staff must record the agreed protocol.');
  for(const [key,label,type,options,max,step] of fields[kind]){
   const value=detail[key];if(value===undefined||value===null||value==='')throw Error(label+' is required.');
   if(type==='number'&&(!Number.isFinite(Number(value))||Number(value)<options||Number(value)>max||(step===1&&!Number.isInteger(Number(value)))))throw Error(label+' is outside its permitted range.');
   if(type==='text'&&(String(value).trim().length<1||String(value).length>300))throw Error(label+' must contain 1–300 characters.');
   if(type==='select'&&!(['turned','protected'].includes(key)?typeof value==='boolean':options.includes(value)))throw Error('Choose a valid '+label.toLowerCase());
   if(type==='datetime-local'&&(!Number.isFinite(Date.parse(value))||Date.parse(value)>Date.now()))throw Error(label+' must be an actual time, not a future time.');
  }
  if(kind==='quality'){
   if(Number(detail.moldy)+Number(detail.slaty)+Number(detail.insect_damaged)>Number(detail.sample_beans))throw Error('Defect categories must not overlap or exceed the sample size.');
   if(role==='farmer'&&detail.grade!=='ungraded')throw Error('Assigned staff must record the final grade.');
  }
  return detail;
 }
 async function start(){
  const $=id=>document.getElementById(id),node=(tag,text,cls)=>{const el=document.createElement(tag);el.textContent=text??'';if(cls)el.className=cls;return el;},tell=(text,error=false)=>notify('page-status',text,error);
  let batches=[],records=[],pending=null,busy=false,correction=null,chart,loadVersion=0;
  const localDate=value=>{const d=new Date(value??Date.now());return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
  const options=(select,rows)=>{select.replaceChildren();for(const [value,label] of rows){const option=node('option',label);option.value=value;select.append(option);}};
  function controls(detail={}){
   const kind=$('process-kind').value;const root=$('process-fields');root.replaceChildren();
   for(const [key,label,type,values,max,step] of fields[kind]){
    const wrapper=node('label',label),input=document.createElement(type==='select'?'select':'input');input.id='process-'+key;input.name=key;input.required=true;
    if(type==='select'){const choices=key==='grade'&&currentAccount.profile.role==='farmer'?['ungraded']:values;options(input,choices.map(value=>[value,value==='ungraded'?'Awaiting staff grade':value]));}
    else{input.type=type;if(type==='number'){input.min=values;input.max=max;input.step=step;}else if(type==='text')input.maxLength=300;}
    if(detail[key]!=null)input.value=type==='datetime-local'?localDate(detail[key]):typeof detail[key]==='boolean'?detail[key]?'yes':'no':detail[key];
    wrapper.append(input);root.append(wrapper);
   }
   $('process-instruction').textContent=kind==='protocol'?'Use targets agreed with your buyer or qualified adviser. This is a process reference, not certification.':kind==='quality'?'Count each defective bean in one category only. Farmers enter observations; assigned staff record the final grade.':kind==='handover'?'This records who entered a handover. A typed recipient name is not a digital acceptance signature.':kind==='cost'?'Log post-harvest costs only. These figures do not establish total farm profit.':'Enter measured observations. No sensor is connected automatically.';
  }
  function portfolio(){
   const m=metrics(batches,records);$('process-sales').textContent='PHP '+m.sales.toLocaleString('en-PH',{maximumFractionDigits:2});$('process-costs').textContent='PHP '+m.costs.toLocaleString('en-PH',{maximumFractionDigits:2});$('process-margin').textContent='PHP '+m.margin.toLocaleString('en-PH',{maximumFractionDigits:2});$('process-downgrade').textContent=m.downgradePct===null?'Not assessed':m.downgradePct.toFixed(1)+'%';
   $('process-metric-note').textContent=m.soldCount+' sold batches · '+m.gradedCount+' graded batches · '+m.assessedKg.toFixed(3)+' kg assessed snapshot weight. Financial figures cover sold batches and their logged post-harvest costs only; unlogged costs and farming costs are excluded. These are recorded outcomes, not evidence of income uplift.';
   if(m.soldKg)$('process-metric-note').textContent+=' Sold weight: '+m.soldKg.toFixed(3)+' kg · Recorded sale price: PHP '+m.pricePerKg.toFixed(2)+'/kg · Logged processing cost: PHP '+m.costPerKg.toFixed(2)+'/kg.';
  }
  function render(){
   const batch=batches.find(row=>row.id===$('process-batch').value),list=$('process-checks');list.replaceChildren();
   $('process-record-button').disabled=!batch||!!pending;$('process-stage-link').href='batches.html'+(batch?'?batch='+encodeURIComponent(batch.id):'');
   if(!batch){list.append(node('li','Create a harvest batch to begin.'));$('process-history').replaceChildren();chart?.destroy();chart=null;$('process-chart').hidden=true;$('process-chart-empty').hidden=false;return;}
   for(const text of checks(batch,records))list.append(node('li',text));
   const relevant=records.filter(row=>row.batch_id===batch.id).sort((a,b)=>b.observed_at.localeCompare(a.observed_at)),activeIds=new Set(effective(relevant).map(row=>row.id)),body=$('process-history');body.replaceChildren();
   for(const row of relevant){const tr=node('tr');tr.append(node('td',new Date(row.observed_at).toLocaleString('en-PH',{timeZone:'Asia/Manila'})),node('td',kinds[row.kind]+(activeIds.has(row.id)?'':' (corrected)')),node('td',Object.entries(row.detail).map(([key,value])=>key.replaceAll('_',' ')+': '+value).join(' · ')),node('td',row.note));const td=node('td');
    if(activeIds.has(row.id)&&!(currentAccount.profile.role==='farmer'&&(['protocol'].includes(row.kind)||row.kind==='quality'&&row.detail.grade!=='ungraded'))){const button=node('button','Correct','text-btn');button.type='button';button.addEventListener('click',()=>{if(pending)return tell('Retry the pending submission first.',true);correction=row;$('process-kind').value=row.kind;$('process-kind').disabled=true;controls(row.detail);$('process-observed-at').value=localDate(row.observed_at);$('process-note').value='';$('process-correction').textContent='Correcting a '+kinds[row.kind].toLowerCase()+'. Original history will be retained. Add the reason in Notes.';$('process-form').scrollIntoView({block:'start'});});td.append(button);}tr.append(td);body.append(tr);}
   if(!relevant.length){const tr=node('tr'),td=node('td','No process records yet. Add an agreed protocol and your first check.');td.colSpan=5;tr.append(td);body.append(tr);}
   chart?.destroy();const readings=effective(relevant).filter(row=>['drying','quality'].includes(row.kind)).reverse(),target=latest(relevant,'protocol')?.detail.max_moisture;
   $('process-chart-empty').hidden=readings.length>0&&!!window.Chart;$('process-chart').hidden=!readings.length||!window.Chart;
   if(readings.length&&window.Chart)chart=new Chart($('process-chart'),{type:'line',data:{labels:readings.map(row=>new Date(row.observed_at).toLocaleDateString('en-PH',{timeZone:'Asia/Manila'})),datasets:[{label:'Measured moisture (%)',data:readings.map(row=>Number(row.detail.moisture_pct)),borderColor:'#6fac75',backgroundColor:'#6fac7520',tension:.1},...(target!=null?[{label:'Agreed maximum (%)',data:readings.map(()=>Number(target)),borderColor:'#bd9b4c',borderDash:[5,5],pointRadius:0}]:[])]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,max:100}}}});
  }
  async function load(){
   const version=++loadVersion;const data=await Promise.all([listAll('harvest_batches'),listAll('postharvest_records')]);if(version!==loadVersion)return;const choice=$('process-batch').value;
   batches=data[0];records=data[1];if(currentAccount.profile.role==='farmer'){batches=batches.filter(row=>row.owner_id===currentAccount.user.id);records=records.filter(row=>row.owner_id===currentAccount.user.id);}
   const plantation=new URLSearchParams(location.search).get('plantation');if(plantation)batches=batches.filter(row=>row.plantation_id===plantation);
   options($('process-batch'),[['','Choose a batch'],...batches.map(row=>[row.id,row.code+' · '+row.stage.replaceAll('_',' ')])]);const requested=choice||new URLSearchParams(location.search).get('batch');$('process-batch').value=batches.some(row=>row.id===requested)?requested:batches[0]?.id||'';portfolio();render();
  }
  function reset(){correction=null;$('process-kind').disabled=false;$('process-form').reset();$('process-observed-at').value=localDate();$('process-correction').textContent='';controls();}
  function lock(on){for(const el of $('process-form').elements)el.disabled=on;$('process-batch').disabled=on;if(!on)$('process-kind').disabled=!!correction;}
  async function save(payload){
   if(busy)return;if(!navigator.onLine)return tell('Connect to save post-harvest observations. Nothing was submitted.',true);
   pending??={id:crypto.randomUUID(),payload};busy=true;lock(true);$('process-retry').hidden=true;tell('Saving process record…');
   try{
    const {data,error}=await db.rpc('record_postharvest',{p_request_id:pending.id,p_payload:pending.payload});if(error){if(error.code&&error.code!=='57014'){pending=null;lock(false);}throw error;}if(!data)throw Error('No server acknowledgement received.');
    pending=null;lock(false);reset();try{await load();tell('Process record saved and confirmed.');}catch{tell('Saved and confirmed, but history could not reload. Refresh records before entering it again.',true);}
   }catch(error){tell(error.message+(pending?' Confirmation is uncertain. Retry the same submission before changing it.':''),true);$('process-retry').hidden=!pending;}finally{busy=false;}
  }
  try{
   if(!await requireSession())return;options($('process-kind'),Object.entries(kinds).filter(([kind])=>currentAccount.profile.role!=='farmer'||kind!=='protocol'));reset();
   $('process-kind').addEventListener('change',()=>controls());$('process-batch').addEventListener('change',()=>{if(!pending){reset();render();}});
   $('process-reset').addEventListener('click',()=>{if(!pending)reset();});$('process-retry').addEventListener('click',()=>pending&&save(pending.payload));
   $('process-refresh').addEventListener('click',async()=>{if(pending)return tell('Retry the pending submission first.',true);try{await load();tell('Process records updated.');}catch(error){tell('Records could not reload; previously displayed figures may be out of date. '+error.message,true);}});
   $('process-form').addEventListener('submit',event=>{event.preventDefault();try{
    const kind=$('process-kind').value,detail={};for(const [key,,type] of fields[kind]){const value=$('process-'+key).value;detail[key]=['turned','protected'].includes(key)?value==='yes':type==='number'?Number(value):type==='datetime-local'?new Date(value).toISOString():value.trim();}
    validate(kind,detail,currentAccount.profile.role);const observed=new Date($('process-observed-at').value);if(!Number.isFinite(+observed)||observed>Date.now())throw Error('Observation time must be valid and not in the future.');if($('process-note').value.trim().length<3)throw Error('Add a note of at least 3 characters.');if(!$('process-batch').value)throw Error('Choose a batch.');
    const payload={batch_id:$('process-batch').value,kind,observed_at:observed.toISOString(),detail,note:$('process-note').value.trim()};if(correction)payload.supersedes_id=correction.id;save(payload);
   }catch(error){tell(error.message,true);}});
   $('process-export').addEventListener('click',()=>{const batch=batches.find(row=>row.id===$('process-batch').value);if(!batch)return;const rows=records.filter(row=>row.batch_id===batch.id),ids=new Set(effective(rows).map(row=>row.id));const csv='\uFEFF'+[['batch','record_id','kind','observed_at','effective','detail','notes','actor_role','recorded_at'],...rows.map(row=>[batch.code,row.id,row.kind,row.observed_at,ids.has(row.id),JSON.stringify(row.detail),row.note,row.actor_role,row.created_at])].map(row=>row.map(CacaoApp.csvValue).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=node('a');a.href=url;a.download='caaps-postharvest.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
   $('process-print').addEventListener('click',()=>window.print());tell('Loading post-harvest records…');await load();tell('Showing authorized batch observations and recorded outcomes.');
  }catch(error){tell('Post-harvest records are unavailable. Check your connection or ask your administrator to enable this workspace. Farm records remain available.'+(currentAccount?.profile?.role==='super_admin'?' Verify migrations 010 and 011 in staging, then reload.':''),true);$('process-record-button').disabled=true;for(const id of ['process-sales','process-costs','process-margin','process-downgrade'])$(id).textContent='Unavailable';}
 }
 return {start,fields,kinds,effective,latest,metrics,checks,validate};
})();
CacaoPostharvest.start();
