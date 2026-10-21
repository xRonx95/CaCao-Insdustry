// Farmer registration page behavior.
const $ = id => document.getElementById(id);
function statusMessage(message, error = false) {
  $('auth-status').textContent = message;
  $('auth-status').className = 'status ' + (error ? 'error' : 'success');
}
async function redirectSession(session) {
  if (!session?.user) return;
  const { profile } = await accountAccess();
  location.replace(roleHome(profile.role));
}
$('signup-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!configured) return statusMessage('Set your Supabase credentials in assets/js/config.js.', true);
  if ($('password').value !== $('confirm-password').value) return statusMessage('Passwords do not match.', true);
  if (!$('full-name').value.trim()) return statusMessage('Enter your full name.', true);
  $('submit-auth').disabled = true;
  try {
    const { data, error } = await db.auth.signUp({
      email: $('email').value.trim(), password: $('password').value,
      options: { data: { full_name: $('full-name').value.trim() }, emailRedirectTo: new URL('login.html', location.href).href }
    });
    if (error) throw error;
    if (data.session) await redirectSession(data.session);
    else { $('signup-form').reset(); statusMessage('Account created. Check your email to verify your account, then log in.'); }
  } catch (error) { statusMessage(error.message, true); }
  finally { $('submit-auth').disabled = false; }
});
async function start() {
  if (!configured) return statusMessage('Set your Supabase credentials in assets/js/config.js.', true);
  if(sessionStorage.getItem('cacao-logout-pending')||localStorage.getItem('cacao-logout-pending')){location.replace('login.html?locked=1');return;}
  const { data, error } = await db.auth.getSession();
  if (error) throw error;
  await redirectSession(data.session);
}
start().catch(error => statusMessage(error.message, true));
