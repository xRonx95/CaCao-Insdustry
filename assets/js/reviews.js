// Profile review decisions remain online and are enforced by migration 009.
window.CacaoReviews = (() => {
  const $ = id => document.getElementById(id);
  const node = (tag, value) => { const item=document.createElement(tag); item.textContent=value ?? ''; return item; };
  const label = status => ({pending:'Pending review',approved:'Approved',rejected:'Needs correction',submitted:'Submitted',resubmitted:'Resubmitted',baseline:'Existing record'})[status] || status;
  const unwrap = async query => { const {data,error}=await query; if(error)throw error; return data; };
  const notifyError = error => notify('page-status', error.message || 'Review operation failed.', true);
  const validateNote = note => {
    const value=note.trim();
    if(value.length<10 || value.length>2000)throw new Error('Write feedback between 10 and 2000 characters.');
    return value;
  };
  async function start() {
    try {
      if(!await requireSession())return;
      const canReview=['admin','super_admin'].includes(currentAccount.profile.role);
      let profiles=[],selected=null,loading=false,selectionVersion=0;
      $('review-status').value=canReview?'pending':'';
      $('review-decision-form').classList.add('hidden');
      $('resubmit-profile').classList.add('hidden');
      function renderList() {
        const search=$('review-search').value.trim().toLowerCase(),status=$('review-status').value;
        const matches=profiles.filter(row=>(!status||row.registration_status===status)&&(!search||[row.full_name,row.barangay].join(' ').toLowerCase().includes(search)));
        $('review-count').textContent=matches.length+' matching profiles · '+profiles.filter(row=>row.registration_status==='pending').length+' pending · '+profiles.filter(row=>row.registration_status==='rejected').length+' need correction';
        const list=$('review-profiles'); list.replaceChildren();
        for(const row of matches) {
          const item=node('article'); item.className='workflow-action';
          const button=node('button',row.full_name+' — '+label(row.registration_status));button.type='button';button.className='text-btn';
          if(row.id===selected?.id)button.setAttribute('aria-current','true');
          button.addEventListener('click',()=>select(row.id).catch(notifyError));
          item.append(button,node('p',row.barangay+' · Updated '+CacaoApp.dateTime(row.updated_at)));list.append(item);
        }
        if(!matches.length)list.append(node('p','No profiles match this view. Choose another status or clear the search.'));
      }
      function toggleBusy(value) {
        loading=value; $('review-refresh').disabled=value;
        $('review-submit').disabled=value; $('resubmit-profile').disabled=value;
      }
      async function select(id) {
        if(loading)return;
        const version=++selectionVersion;
        selected=null;
        $('review-detail').classList.add('hidden');
        $('review-decision-form').reset();
        const [row,events]=await Promise.all([getRecord('farmers',id),unwrap(db.from('farmer_profile_reviews').select('*').eq('farmer_id',id).order('created_at',{ascending:false}))]);
        if(version!==selectionVersion)return;
        selected=row;
        $('review-detail').classList.remove('hidden');
        $('review-title').textContent=row.full_name;
        const facts=$('review-facts');facts.replaceChildren();
        for(const [title,value] of [['Profile status',label(row.registration_status)],['Barangay',row.barangay],['Contact',row.contact_number],['Updated',CacaoApp.dateTime(row.updated_at)]])facts.append(node('dt',title),node('dd',value||'Not recorded'));
        $('review-edit').href='farmers.html?id='+encodeURIComponent(row.id);
        const attachments=$('review-attachments');attachments.replaceChildren();
        if(row.photo_path){const button=node('button','View profile photo');button.type='button';button.className='text-btn';button.addEventListener('click',()=>CacaoApp.viewPhoto(row.photo_path).catch(notifyError));attachments.append(button);}
        const docs=node('a','View profile and supporting documents');docs.href='farmers.html?id='+encodeURIComponent(row.id);attachments.append(docs);
        const history=$('review-history');history.replaceChildren();
        for(const entry of events) {
          const item=node('li'); item.append(node('strong',label(entry.decision)),node('p',entry.note),node('small',CacaoApp.dateTime(entry.created_at)+(entry.actor_id?' · Account '+entry.actor_id.slice(0,8):'')));history.append(item);
        }
        if(!events.length)history.append(node('li','No review history is available for this profile.'));
        $('review-decision-form').classList.toggle('hidden',!canReview||row.registration_status!=='pending');
        $('resubmit-profile').classList.toggle('hidden',row.registration_status!=='rejected');
        $('review-help').textContent=row.registration_status==='rejected'?'Read the correction reason below. Edit and save your profile to return it to review, or resubmit if no profile changes are needed.':row.registration_status==='pending'?'This submission is waiting for an administrator. Profile changes require a fresh review.':'This profile is approved. Substantive profile edits return it to pending review.';
        renderList();
      }
      async function refresh(id) {
        const version=++selectionVersion;
        profiles=(await listAll('farmers')).sort((a,b)=>(a.updated_at||'').localeCompare(b.updated_at||''));
        if(version!==selectionVersion)return;
        selected=null;renderList();
        const target=id||new URLSearchParams(location.search).get('farmer');
        if(target&&profiles.some(row=>row.id===target))await select(target);
        else {$('review-detail').classList.add('hidden');if(target)notify('page-status','That profile is unavailable within your authorized scope.',true);}
      }
      $('review-search').addEventListener('input',renderList);$('review-status').addEventListener('change',renderList);
      $('review-refresh').addEventListener('click',()=>{if(!loading)refresh(selected?.id).catch(notifyError);});
      $('review-decision-form').addEventListener('submit',async event=>{
        event.preventDefault();if(loading||!selected)return;
        const current=selected;
        try {
          if(!canReview)throw new Error('Only administrators may approve or request corrections to profiles.');
          const note=validateNote($('review-note').value);
          if(!navigator.onLine)throw new Error('Connect to submit a review decision.');
          toggleBusy(true);
          await unwrap(db.rpc('review_farmer_profile',{target:current.id,expected_updated_at:current.updated_at,decision:$('review-decision').value,note}));
          toggleBusy(false);await refresh(current.id);
          notify('page-status','Review saved. The owner can read your feedback in the review inbox.');
        }catch(error){notifyError(error);}finally{toggleBusy(false);}
      });
      $('resubmit-profile').addEventListener('click',async()=>{
        if(loading||!selected)return;const current=selected;
        try {
          if(!navigator.onLine)throw new Error('Connect to resubmit this profile.');
          toggleBusy(true);
          await unwrap(db.rpc('resubmit_farmer_profile',{target:current.id,expected_updated_at:current.updated_at}));
          toggleBusy(false);await refresh(current.id);notify('page-status','Profile resubmitted for review.');
        }catch(error){notifyError(error);}finally{toggleBusy(false);}
      });
      await refresh();notify('page-status','Review inbox loaded for your authorized profiles.');
    }catch(error){notify('page-status','Unable to load review inbox. Apply database migration 009 if it is not installed. '+error.message,true);}
  }
  return {start,validateNote,label};
})();
CacaoReviews.start();
