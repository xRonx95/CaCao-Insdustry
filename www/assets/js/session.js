// Verify sessions and protected DB roles before revealing any private page.
const $ = id => document.getElementById(id);
const notify = (id, message, error = false) => {
  const element = $(id);
  if (!element) return;
  element.textContent = message;
  element.className = 'status ' + (error ? 'error' : 'success');
};
const humanArea = value => (Number(value || 0) / 10000).toFixed(4) + ' ha';
let currentAccount;
const farmerFeatures = new Set(['dashboard','farmers','plantations','plantation-form','atlas','trees','posts','history','harvests','pests','treatments','maintenance','tree-events','tree-tags','sync']);
async function requireSession() {
  if (!configured) throw new Error('Set your Supabase credentials in assets/js/config.js and run SQL migrations 001 through 007.');
  if(sessionStorage.getItem('cacao-logout-pending')||localStorage.getItem('cacao-logout-pending')){location.replace('../login.html?locked=1');return false;}
  function useOfflineAccount(expectedUserId) {
    const saved = savedOfflineAccount(expectedUserId);
    if(!saved)throw new Error('Connect and verify your account before opening offline field records.');
    currentAccount=saved;
    if (saved.profile.role !== 'farmer') throw new Error('Offline work is available only to farmers. Connect to use the staff workspace.');
    window.cacaoOfflineSession=true;
    notify('page-status','Offline draft mode. Unlock encrypted field data; permissions will be checked again before synchronization.');
  }
  window.cacaoOfflineSession=false;
  if(!navigator.onLine){
    useOfflineAccount();
  }else{
    let sessionUserId;
    try {
    const { data, error } = await db.auth.getSession();
    if (error) throw error;
    if (!data.session) { location.replace('../login.html'); return false; }
    sessionUserId=data.session.user?.id;
    currentAccount = await accountAccess();
    rememberVerifiedAccount(currentAccount);
    } catch (error) {
      if (!connectionFailure(error)) throw error;
      useOfflineAccount(sessionUserId);
    }
  }
  const role = currentAccount.profile.role;
  const pageRole = document.body.dataset.pageRole;
  if (role !== pageRole && !(pageRole === 'admin' && role === 'super_admin')) {
    location.replace(roleHome(role, '../')); return false;
  }
  if (role === 'farmer' && !farmerFeatures.has(document.body.dataset.feature)) {
    location.replace(roleHome(role, '../')); return false;
  }
  if (window.cacaoOfflineSession && !['plantations','plantation-form','atlas','trees','sync'].includes(document.body.dataset.feature)) {
    location.replace('../farmer/plantations.html'); return false;
  }
  $('account-email').textContent = currentAccount.user.email || 'Offline field account';
  $('page-content').classList.remove('hidden');
  document.querySelectorAll('[data-super-only]').forEach(el => el.classList.toggle('hidden', role !== 'super_admin'));
  if (role === 'farmer') document.getElementById('field-toolbar')?.classList.remove('hidden');
  window.CacaoSync?.accountReady();
  return true;
}
$('logout')?.addEventListener('click', async () => {
  window.CacaoSync?.lock();sessionStorage.removeItem('cacao-last-account');sessionStorage.setItem('cacao-logout-pending','1');
  localStorage.removeItem('cacao-offline-account');localStorage.setItem('cacao-logout-pending','1');
  $('page-content')?.classList.add('hidden');
  try {
    const { error } = await db.auth.signOut({scope:'local'});
    if (error) throw error;
    sessionStorage.removeItem('cacao-logout-pending');
    localStorage.removeItem('cacao-logout-pending');
    location.replace('../index.html');
  } catch { location.replace('../login.html?locked=1'); }
});
if (db) db.auth.onAuthStateChange((event,session) => {
  if (event === 'SIGNED_OUT') {window.CacaoSync?.lock();sessionStorage.removeItem('cacao-last-account');localStorage.removeItem('cacao-offline-account');location.replace('../login.html');}
  if(event==='SIGNED_IN'&&currentAccount&&session?.user?.id!==currentAccount.user.id){window.CacaoSync?.lock();sessionStorage.removeItem('cacao-last-account');$('page-content')?.classList.add('hidden');location.replace('../login.html');}
});
