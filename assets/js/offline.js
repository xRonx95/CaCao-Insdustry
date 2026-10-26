// Register only a public static shell. No authenticated API response is cached by the worker.
window.CacaoOffline = (() => {
  const script=document.currentScript;
  const root=script?new URL('../../',script.src):new URL('./',location.href);
  let registration;
  const nativeBundle=()=>window.Capacitor?.isNativePlatform?.()===true;
  async function register(){
    if(!('serviceWorker' in navigator)||!window.isSecureContext||location.protocol==='file:')return null;
    registration=await navigator.serviceWorker.register(new URL('service-worker.js',root),{scope:root.pathname});
    navigator.serviceWorker.addEventListener('controllerchange',()=>window.dispatchEvent(new CustomEvent('cacao-sync-change')));
    return registration;
  }
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
