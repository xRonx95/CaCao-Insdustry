// Register only a public static shell. No authenticated API response is cached by the worker.
window.CacaoOffline = (() => {
  const script=document.currentScript;
  const root=script?new URL('../../',script.src):new URL('./',location.href);
  let registration;
  let checkTime=0,hadController=!!navigator.serviceWorker?.controller;
  const nativeBundle=()=>window.Capacitor?.isNativePlatform?.()===true;
  async function register(){
    if(!('serviceWorker' in navigator)||!window.isSecureContext||location.protocol==='file:')return null;
    if(registration)return registration;
    registration=await navigator.serviceWorker.register(new URL('service-worker.js',root),{scope:root.pathname,updateViaCache:'none'});
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      window.dispatchEvent(new CustomEvent('cacao-sync-change'));
      if(hadController)showUpdate();hadController=true;
    });
    checkTime=Date.now();
    return registration;
  }
  function showUpdate(){
    if(document.getElementById('app-update-notice'))return;
    const notice=document.createElement('aside');notice.id='app-update-notice';notice.className='app-update-notice';notice.setAttribute('role','status');
    const text=document.createElement('span');text.textContent='A new version is available. Save or synchronize your work, then reload to apply it.';
    const reload=document.createElement('button');reload.type='button';reload.className='btn secondary';reload.textContent='Reload app';reload.addEventListener('click',()=>{if(confirm('Reload the app now? Unsaved form entries will be lost. Save or synchronize your work first.'))location.reload();});
    const later=document.createElement('button');later.type='button';later.className='text-btn';later.textContent='Later';later.addEventListener('click',()=>notice.remove());
    notice.append(text,reload,later);document.body.append(notice);
  }
  async function checkUpdate(){
    if(!navigator.onLine||Date.now()-checkTime<300000)return;
    checkTime=Date.now();
    try{const current=await register();await current?.update();}catch{/* Keep the prepared offline app available. */}
  }
  window.addEventListener?.('online',checkUpdate);
  document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible')checkUpdate();});
  async function prepareLibraries(){
    if(nativeBundle())return {failed:[],native:true};
    if(!('serviceWorker' in navigator))throw new Error('This browser does not support the offline page cache.');
    const registered=await register();
    if(!registered)throw new Error('Offline preparation requires HTTPS or localhost. Open the site through a web server, not directly as a file.');
    const ready=await navigator.serviceWorker.ready;
    const channel=new MessageChannel();
    const report=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{channel.port1.close();reject(new Error('Offline page preparation timed out. Keep this device online and try Prepare again.'));},180000);
      channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();resolve(event.data);};
      ready.active.postMessage({type:'CACHE_LIBRARIES'},[channel.port2]);
    });
    if(report.failed?.length)throw new Error('Records were encrypted, but '+report.failed.length+' offline page or library files could not be prepared. Reconnect and try again before field use.');
    return report;
  }
  // Let visible page resources finish before starting installation downloads.
  if(document.readyState==='complete')register().catch(()=>{});
  else window.addEventListener?.('load',()=>register().catch(()=>{}),{once:true});
  return {register,prepareLibraries,nativeBundle};
})();
