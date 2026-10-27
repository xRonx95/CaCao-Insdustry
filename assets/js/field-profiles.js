window.CacaoFieldProfiles=(()=>{
 const $=id=>document.getElementById(id);
 const label=value=>({pending:'Pending administrator review',approved:'Approved',rejected:'Needs correction',submitted:'Submitted',resubmitted:'Resubmitted'})[value]||value;
 const node=(tag,value)=>{const el=document.createElement(tag);el.textContent=value??'';return el;};
 const unwrap=async query=>{const {data,error}=await query;if(error)throw error;return data;};
 const feedback=value=>{const clean=value.trim();if(clean.length<10||clean.length>2000)throw Error('Write feedback between 10 and 2000 characters.');return clean;};
 async function start(){
  try{
   if(!await requireSession())return;
   const role=currentAccount.profile.role,admin=['admin','super_admin'].includes(role),field=role==='field';
   if(!admin&&!field)throw Error('This workspace is for field personnel and administrators.');
   let rows=[],selected=null,busy=false,version=0,loaded=false;
   const tell=(text,error=false)=>notify('page-status',text,error);
   const lock=value=>{busy=value;for(const id of ['staff-save','staff-review-submit','staff-refresh'])$(id).disabled=value;if(admin)renderList();};
   const fields=[['full_name','staff-full-name'],['phone','staff-phone'],['address','staff-address'],['position','staff-position'],['notes','staff-notes']];
   $('staff-own-panel').classList.toggle('hidden',!field);
   $('staff-inbox').classList.toggle('hidden',!admin);
   lock(true);
   function renderList(){
    const matches=rows.filter(row=>(!$('staff-filter').value||row.registration_status===$('staff-filter').value)&&row.full_name.toLowerCase().includes($('staff-search').value.trim().toLowerCase()));
    $('staff-count').textContent=matches.length+' matching profiles';$('staff-list').replaceChildren();
    for(const row of matches){const item=node('article'),button=node('button',row.full_name+' — '+label(row.registration_status));button.type='button';button.className='text-btn';button.disabled=busy;button.addEventListener('click',()=>show(row).catch(error=>tell(error.message,true)));item.append(button);$('staff-list').append(item);}
    if(!matches.length)$('staff-list').append(node('p','No profiles match this view.'));
   }
   async function show(row){
    const current=++version;selected=null;$('staff-detail').classList.add('hidden');$('staff-review-form').classList.add('hidden');$('staff-feedback').value='';
    if(!row)return;
    const events=await unwrap(db.from('field_profile_reviews').select('*').eq('profile_id',row.id).order('created_at',{ascending:false}));
    if(current!==version)return;
    selected=row;$('staff-title').textContent=row.full_name+' — '+label(row.registration_status);
    $('staff-facts').replaceChildren();
    for(const [title,value] of [['Status',label(row.registration_status)],['Contact',row.phone],['Address',row.address],['Position',row.position],['Notes',row.notes],['Updated',CacaoApp.dateTime(row.updated_at)]])$('staff-facts').append(node('dt',title),node('dd',value||'Not recorded'));
    $('staff-history').replaceChildren();
    for(const entry of events){const li=node('li');li.append(node('strong',label(entry.decision)),node('p',entry.note),node('small',CacaoApp.dateTime(entry.created_at)));$('staff-history').append(li);}
    $('staff-detail').classList.remove('hidden');$('staff-review-form').classList.toggle('hidden',!admin||row.registration_status!=='pending');
   }
   async function load(id){
    rows=await listAll('field_profiles');loaded=true;
    if(field){const own=rows.find(row=>row.id===currentAccount.user.id);for(const [key,id] of fields)$(id).value=own?.[key]??(key==='full_name'?currentAccount.profile.display_name||'':'');await show(own);}
    else{renderList();await show(rows.find(row=>row.id===id));}
   }
   $('staff-search').addEventListener('input',renderList);$('staff-filter').addEventListener('change',renderList);
   $('staff-refresh').addEventListener('click',async()=>{if(busy)return;lock(true);try{await load(selected?.id);tell('Profile status refreshed.');}catch(error){tell(error.message,true);}finally{lock(false);}});
   $('staff-profile-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    try{
     if(!field)throw Error('Only field personnel can submit their own staff profile.');
     if(!loaded)throw Error('Wait for the profile to finish loading.');
     if(!navigator.onLine)throw Error('Connect to submit your profile.');
     const payload=Object.fromEntries(fields.map(([key,id])=>[key,$(id).value.trim()]));
     for(const [key]of fields)if(key!=='notes'&&!payload[key])throw Error('Complete all required profile details.');
     lock(true);
     const saved=await unwrap(db.rpc('save_field_profile',{expected_updated_at:rows.find(row=>row.id===currentAccount.user.id)?.updated_at||null,p_payload:payload}));
     if(!saved)throw Error('No server confirmation received. Refresh profile status before retrying.');
     await load(saved.id);tell('Staff profile submitted. An administrator must review it.');
    }catch(error){tell(error.message,true);}finally{lock(false);}
   });
   $('staff-review-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||!selected)return;
    try{
     if(!admin)throw Error('Only administrators may review field profiles.');
     if(!navigator.onLine)throw Error('Connect to save a review decision.');
     const note=feedback($('staff-feedback').value),decision=$('staff-decision').value;
     if(!['approved','rejected'].includes(decision))throw Error('Choose approve or request corrections.');
     lock(true);const current=selected;
     await unwrap(db.rpc('review_field_profile',{target:current.id,expected_updated_at:current.updated_at,decision,note}));
     $('staff-feedback').value='';await load(current.id);tell('Review saved. The field staff member can read your feedback.');
    }catch(error){tell(error.message,true);}finally{lock(false);}
   });
   await load();lock(false);tell(field?'Submit your details for administrator approval.':'Choose a pending field staff profile to review.');
  }catch(error){notify('page-status','Staff profiles unavailable. Apply migration 013 after 001–012. '+error.message,true);}
 }
 return {start,feedback,label};
})();
CacaoFieldProfiles.start();
