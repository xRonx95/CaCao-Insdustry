// Plantation profile, optimistic updates, private media and mapping frame bridge.
let mappingReady=false, mappingData={boundary:null,area_sqm:0,capture_method:'manual',gps_accuracy:[],gps_samples:[]};
let originalFarm=null, registeredFarmers=[];
let pendingRecordId=crypto.randomUUID(),pendingChangeId=crypto.randomUUID();
let mappingTab=null,mappingTabReady=false;
const mappingBridge=crypto.randomUUID();
function sendBoundary(){
  if(!currentAccount)return;
  const payload={type:'load-boundary',...mappingData,draftId:'walking-'+currentAccount.user.id+'-'+(originalFarm?.id||pendingRecordId)};
  if(mappingReady)$('boundary-map').contentWindow.postMessage(payload,location.origin);
  if(mappingTabReady&&mappingTab&&!mappingTab.closed)mappingTab.postMessage({...payload,bridge:mappingBridge},location.origin);
}
function openMapping(){
  if(!currentAccount)return;
  if(mappingTab&&!mappingTab.closed){mappingTab.focus();return;}
  mappingTabReady=false;
  mappingTab=window.Capacitor?.isNativePlatform?.()?null:window.open('mapping.html?full=1&bridge='+encodeURIComponent(mappingBridge),'cacao-mapping-'+mappingBridge);
  if(!mappingTab){
    document.body.classList.add('mapping-expanded');
    $('close-expanded-map').hidden=false;
    notify('form-status','Your browser kept mapping in this page. Use Return to plantation form when finished.');
  }
}
$('open-mapping').addEventListener('click',openMapping);
$('close-expanded-map').addEventListener('click',()=>{document.body.classList.remove('mapping-expanded');$('close-expanded-map').hidden=true;});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin)return;
  const frame=event.source===$('boundary-map').contentWindow;
  const tab=mappingTab&&event.source===mappingTab&&event.data?.bridge===mappingBridge;
  if(!frame&&!tab)return;
  if(event.data?.type==='open-mapping'&&frame){openMapping();return;}
  if(event.data?.type==='mapping-ready'){if(frame)mappingReady=true;else mappingTabReady=true;sendBoundary();}
  if(['boundary-change','mapping-finished'].includes(event.data?.type)&&event.data.value){
    mappingData=event.data.value;
    if(event.data.type==='mapping-finished'){
      mappingReady=true;mappingTabReady=false;
      $('boundary-map').contentWindow.postMessage({type:'load-boundary',...mappingData,draftId:'walking-'+currentAccount.user.id+'-'+(originalFarm?.id||pendingRecordId)},location.origin);
      notify('form-status','Boundary returned from mapping. Review the plantation details and save the plantation.');
    }
  }
});
function useFarmerAccount(){
  if(currentAccount.profile.role!=='farmer')return;
  $('farmer-label').textContent='Farmer account';
  $('owner-name').readOnly=true;
  const select=$('farmer-record');select.value=registeredFarmers[0]?.id||'';select.disabled=registeredFarmers.length===1;
  $('farmer-account-note').textContent='Using your signed-in farmer account: '+(currentAccount.user.email||currentAccount.profile.display_name||'Verified farmer')+'.';
  setFarmer();
}
function setFarmer(){
  const farmer=registeredFarmers.find(row=>row.id===$('farmer-record').value);
  $('owner-name').value=farmer?.full_name||'';
  if(farmer&&!originalFarm){$('barangay').value=farmer.barangay||'';$('municipality').value=farmer.municipality||'Isabela City';$('province').value=farmer.province||'Basilan';}
}
function resetForm(){
  if(mappingTab&&!mappingTab.closed){notify('form-status','Finish mapping and return before starting a different plantation.',true);return;}
  mappingTab=null;mappingTabReady=false;
  pendingRecordId=crypto.randomUUID();pendingChangeId=crypto.randomUUID();originalFarm=null;history.replaceState(null,'',location.pathname);$('plantation-form').reset();$('plantation-id').value='';$('form-title').textContent='Register a plantation';$('plantation-photos').replaceChildren();
  mappingData={boundary:null,area_sqm:0,capture_method:'manual',gps_accuracy:[],gps_samples:[]};sendBoundary();
  $('municipality').value='Isabela City';$('province').value='Basilan';useFarmerAccount();notify('form-status','');
}
$('farmer-record').addEventListener('change',setFarmer);
$('reset-farm').addEventListener('click',resetForm);
$('plantation-form').addEventListener('submit',async event=>{
  event.preventDefault();$('save-farm').disabled=true;
  let saved=false,photoPath;
  try{
    if(mappingTab&&!mappingTab.closed)throw new Error('Choose Use boundary and return in the mapping tab before saving this plantation.');
    const farmer=registeredFarmers.find(row=>row.id===$('farmer-record').value);
    if(!farmer)throw new Error('Select a registered farmer. Create their profile first if it is not listed.');
    if(currentAccount.profile.role==='farmer'&&farmer.owner_id!==currentAccount.user.id)throw new Error('Choose a profile belonging to your signed-in farmer account.');
    if(originalFarm&&originalFarm.owner_id!==farmer.owner_id)throw new Error('Choose a farmer profile owned by the existing plantation account. Ownership cannot be transferred here.');
    if(!mappingReady||!mappingData.boundary)throw new Error('Draw or walk a valid boundary before saving.');
    const count=Number($('tree-count').value);if(!Number.isSafeInteger(count)||count<0)throw new Error('Tree count must be a non-negative whole number.');
    const record={
      ...(originalFarm?{id:originalFarm.id,revision:originalFarm.revision}:{id:pendingRecordId,revision:null}),_change_id:pendingChangeId,
      owner_id:farmer.owner_id,farmer_id:farmer.accountLink?null:farmer.id,farmer_name:farmer.full_name,
      name:$('farm-name').value.trim(),barangay:$('barangay').value.trim(),municipality:$('municipality').value.trim(),province:$('province').value.trim(),
      tree_count:count,variety:$('variety').value,notes:$('notes').value.trim(),address:$('plantation-address').value.trim(),land_tenure:$('land-tenure').value,
      established_on:$('established-on').value||null,status:$('plantation-status').value,
      boundary:mappingData.boundary,capture_method:mappingData.capture_method,gps_accuracy:mappingData.gps_accuracy||[],gps_samples:mappingData.gps_samples||[]
    };
    // Verification is performed through the separate mapping review workflow.
    if(!record.name||!record.barangay||!record.municipality||!record.province)throw new Error('Complete all mandatory farm fields.');
    const file=$('plantation-photo').files[0];
    if(file&&!navigator.onLine)throw new Error('Queue the plantation without a photo while offline, then attach the photo after confirmation.');
    const response=await savePlantation(record);
    if(response.status==='queued'){resetForm();notify('form-status','Plantation and original GPS points saved in the encrypted queue. They will retry while connected and unlocked.');return;}
    const farm=response.record||response;saved=true;originalFarm=farm;pendingChangeId=crypto.randomUUID();$('plantation-id').value=farm.id;history.replaceState(null,'','?id='+encodeURIComponent(farm.id));
    if(file){
      photoPath=await CacaoApp.upload(file,farm.owner_id);
      const last=(mappingData.gps_accuracy||[]).at(-1);
      const {error}=await db.from('plantation_photos').insert({plantation_id:farm.id,owner_id:farm.owner_id,path:photoPath,caption:'Plantation profile photo',latitude:last?.latitude||null,longitude:last?.longitude||null});
      if(error)throw error;
      $('plantation-photo').value='';
    }
    await loadPhotos(farm.id);
    notify('form-status','Saved '+farm.name+'. Server-validated area: '+Number(farm.area_sqm).toLocaleString(undefined,{maximumFractionDigits:2})+' m² ('+humanArea(farm.area_sqm)+'). Revision '+farm.revision+'.');
  }catch(error){notify('form-status',(saved?'The plantation was saved, but its photo could not be attached. ':'Save failed: ')+error.message+(photoPath?' An unused file may remain in private storage.':''),true);}
  finally{$('save-farm').disabled=false;}
});
async function loadPhotos(id){
  if(!navigator.onLine||window.cacaoOfflineSession)return;
  const {data,error}=await db.from('plantation_photos').select('path,created_at').eq('plantation_id',id).order('created_at',{ascending:false});
  if(error)throw error;
  $('plantation-photos').replaceChildren();
  for(const photo of data){const button=document.createElement('button');button.type='button';button.className='btn secondary';button.textContent='View photo · '+new Date(photo.created_at).toLocaleDateString();button.addEventListener('click',()=>CacaoApp.viewPhoto(photo.path).catch(error=>notify('form-status',error.message,true)));$('plantation-photos').append(button);}
}
async function startForm(){
  if(!await requireSession())return;
  registeredFarmers=await listAll('farmers');
  if(window.CacaoSync)registeredFarmers=await CacaoSync.recordsForPicker('farmers',registeredFarmers);
  if(currentAccount.profile.role==='farmer'){
    registeredFarmers=registeredFarmers.filter(row=>row.owner_id===currentAccount.user.id);
    if(!registeredFarmers.length)registeredFarmers=[{id:'account:'+currentAccount.user.id,owner_id:currentAccount.user.id,full_name:currentAccount.profile.display_name||currentAccount.user.user_metadata?.full_name||currentAccount.user.email||'Farmer account',accountLink:true}];
  }
  for(const farmer of registeredFarmers){const option=document.createElement('option');option.value=farmer.id;option.textContent=farmer.full_name+' - '+(farmer.accountLink?'Signed-in account':farmer._offline_pending?'Queued profile':farmer.registration_status||'Registered profile');$('farmer-record').append(option);}
  if(!registeredFarmers.length)notify('form-status','Create a farmer profile in Farmer profiles before registering a plantation.');
  useFarmerAccount();
  $('verification-field').classList.add('hidden');
  const id=new URLSearchParams(location.search).get('id');
  if(id){
    const data=await getRecord('plantations',id);originalFarm=data;
    const values={'plantation-id':data.id,'farmer-record':data.farmer_id,'farm-name':data.name,'owner-name':data.farmer_name,'barangay':data.barangay,'municipality':data.municipality,'province':data.province,'tree-count':data.tree_count,'variety':data.variety,'notes':data.notes,'plantation-address':data.address,'land-tenure':data.land_tenure,'established-on':data.established_on,'plantation-status':data.status,'verification-status':data.verification_status};
    for(const [key,value]of Object.entries(values))$(key).value=value??'';
    if(currentAccount.profile.role==='farmer'){
      $('farmer-record').value=data.farmer_id||registeredFarmers[0]?.id||'';
      setFarmer();
    }
    mappingData={boundary:data.boundary,area_sqm:data.area_sqm,capture_method:data.capture_method,gps_accuracy:data.gps_accuracy||[],gps_samples:data.gps_samples||[]};
    $('form-title').textContent='Edit: '+data.name;
    const version=new URLSearchParams(location.search).get('version');
    if(version){const {data:historical,error:versionError}=await db.from('plantation_boundaries').select('*').eq('id',version).eq('plantation_id',data.id).single();if(versionError)throw versionError;mappingData={boundary:historical.boundary_geojson,area_sqm:historical.area_sqm,capture_method:'import',gps_accuracy:[],gps_samples:[]};notify('form-status','Historical boundary loaded as a draft. Review it before saving a new revision.');}
    await loadPhotos(data.id);
  }else{$('municipality').value='Isabela City';$('province').value='Basilan';}
  sendBoundary();$('save-farm').disabled=false;
}
$('save-farm').disabled=true;
startForm().catch(error=>notify('page-status',error.message,true));
