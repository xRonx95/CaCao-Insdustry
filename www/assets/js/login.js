// Login page behavior.
const $ = id => document.getElementById(id);
function statusMessage(message, error = false) {
  $('auth-status').textContent = message;
  $('auth-status').className = 'status ' + (error ? 'error' : 'success');
  $('auth-status').setAttribute('role', error ? 'alert' : 'status');
  $('auth-status').setAttribute('aria-live', error ? 'assertive' : 'polite');
}
async function redirectSession(session, notify = false) {
  if (!session?.user) return;
  let account;
  try {
    account = await accountAccess();
    rememberVerifiedAccount(account);
  } catch (error) {
    if (notify || !connectionFailure(error)) throw error;
    account = savedOfflineAccount(session.user.id);
    if (!account) throw error;
  }
  const { profile } = account;
  if (notify) {
    statusMessage('Login successful! Opening your dashboard...');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  location.replace(roleHome(profile.role));
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!configured) return statusMessage('Set your Supabase credentials in assets/js/config.js.', true);
  
  $('submit-auth').disabled = true;
  try {
    const { data, error } = await db.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if (error) throw error;
    sessionStorage.removeItem('cacao-logout-pending');
    localStorage.removeItem('cacao-logout-pending');
    if (!data.session?.user) throw new Error('No session was created. Please try again.');
    await redirectSession(data.session, true);
  } catch (error) { statusMessage('Login failed. ' + (error.message || 'Please try again.'), true); }
  finally { $('submit-auth').disabled = false; }
});
async function start() {
  if (!configured) return statusMessage('Set your Supabase credentials in assets/js/config.js.', true);
  if(sessionStorage.getItem('cacao-logout-pending')||localStorage.getItem('cacao-logout-pending')){
    if (!navigator.onLine) return statusMessage('Connect to log in again after signing out.', true);
    const {error}=await db.auth.signOut({scope:'local'});
    if(error)throw new Error('Private field data is locked. Reconnect to complete sign-out, or explicitly log in again.');
    sessionStorage.removeItem('cacao-logout-pending');
    localStorage.removeItem('cacao-logout-pending');
  }
  if (!navigator.onLine) {
    const saved = savedOfflineAccount();
    if (saved?.profile.role === 'farmer') { location.replace('farmer/plantations.html'); return; }
    if (saved) return statusMessage('Staff accounts require an internet connection. Offline mapping and inventory are available only to farmers.', true);
    return statusMessage('Connect and log in once before using this device offline.', true);
  }
  const { data, error } = await db.auth.getSession();
  if (error) throw error;
  await redirectSession(data.session);
}
start().catch(error => statusMessage(error.message, true));

