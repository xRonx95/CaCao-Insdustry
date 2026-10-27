// Keep existing form values and mapping state when closing and reopening.
window.CacaoFarmerModal=(()=>{
  const dialog=document.getElementById('farmer-form-dialog');
  const trigger=document.getElementById('open-farmer-form');
  let launch=open;
  function open(){
    if(!dialog||dialog.open)return;
    dialog.showModal();
    dialog.scrollTop=0;
    const form=dialog.querySelector('form');
    form?.querySelector('input:not([type="hidden"]):not([disabled]),select:not([disabled]),textarea')?.focus({preventScroll:true});
  }
  function close(){dialog?.close();}
  trigger?.addEventListener('click',()=>launch());
  document.getElementById('close-farmer-form')?.addEventListener('click',close);
  dialog?.addEventListener('close',()=>{
    document.body.classList.remove('mapping-expanded');
    const back=document.getElementById('close-expanded-map');
    if(back)back.hidden=true;
    trigger?.focus();
  });
  const status=document.getElementById('page-status');
  if(status)new MutationObserver(()=>{
    const copy=document.getElementById('modal-page-status');
    copy.textContent=status.textContent;copy.className=status.className;
  }).observe(status,{childList:true,subtree:true,attributes:true});
  return {open,close,setLauncher(callback){launch=callback;}};
})();
