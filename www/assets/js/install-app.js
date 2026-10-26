// The installed web app uses this deployment, not the APK's bundled web files.
(() => {
  let installPrompt,installationConfirmed=false;
  const installed=()=>installationConfirmed||window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone===true;
  const status=document.getElementById('install-status');
  const buttons=()=>document.querySelectorAll('[data-install-app]');
  const message=value=>{if(status)status.textContent=value;};
  function render(){buttons().forEach(button=>{button.disabled=installed();button.textContent=installed()?'CaAPs is installed':'Install CaAPs';});}
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;render();});
  window.addEventListener('appinstalled',()=>{installationConfirmed=true;installPrompt=null;render();message('CaAPs is installed. Open it from your home screen.');});
  buttons().forEach(button=>button.addEventListener('click',async()=>{
    if(installed())return;
    if(!installPrompt){message('Android: open the browser menu and choose Install app or Add to Home screen. On iPhone: open this page in Safari, tap Share, then Add to Home Screen.');return;}
    try{const prompt=installPrompt;installPrompt=null;await prompt.prompt();const choice=await prompt.userChoice;message(choice.outcome==='accepted'?'Installation requested. Look for CaAPs on your home screen.':'Installation was cancelled. You can install later from this page.');}
    catch{message('Use your browser menu to install CaAPs or add it to your home screen.');}
  }));
  render();
})();
