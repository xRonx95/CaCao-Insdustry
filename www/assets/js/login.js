// Sign-in feedback; roles are verified on the server before navigation.
const $ = id => document.getElementById(id);
let signingIn=false, initialization=0;
function statusMessage(message,error=false) {
  $('auth-status').textContent=message;
  $('auth-status').className='status '+(error?'error':'success');
  $('auth-status').setAttribute('role',error?'alert':'status');
  $('auth-status').setAttribute('aria-live',error?'assertive':'polite');
}
function loginError(error) {
  const code=error?.code||'',message=error?.message||'';
  if(/login library|login service configuration/i.test(message))return message;
  if(['invalid_credentials','invalid_login_credentials'].includes(code)||/invalid login credentials/i.test(message))return 'The email or password is incorrect. Check both, or use Forgot password. The login service does not identify which one is incorrect.';
  if(code==='email_not_confirmed'||/email not confirmed/i.test(message))return 'Your email has not been verified. Open the confirmation email and verify your account before logging in.';
  if(code==='user_banned'||/suspended|banned/i.test(message))return 'Your account is suspended. Contact the system administrator.';
  if(error?.status===429||/rate.limit|too many requests/i.test(message))return 'Too many login attempts. Wait a few minutes before trying again.';
  if(error?.name==='TimeoutError'||/timed out|timeout/i.test(message))return 'The login service took too long to respond. Check your connection and try again.';
  if(connectionFailure(error)||!navigator.onLine)return 'Cannot reach the login service. Check your internet connection and try again.';
  if(/session.*expired|no session was created/i.test(message))return 'Your login session could not be verified. Please sign in again.';
  if(!db||!configured||error?.status>=500||/api key|project.*paused|service.*unavailable/i.test(message))return 'The login service is unavailable or not configured correctly. Try again later or contact the administrator.';
  if(/profile|schema|migration/i.test(message))return 'Your account profile could not be loaded. Contact the administrator to check your account setup.';
  return 'Sign-in could not be completed. Try again. If this continues, contact the administrator.';
}
async function redirectSession(session,showSuccess=false,version=initialization) {
  if(!session?.user)return false;
  let account;
  try {account=await accountAccess();rememberVerifiedAccount(account);}
  catch(error) {if(showSuccess||!connectionFailure(error))throw error;account=savedOfflineAccount(session.user.id);if(!account)throw error;}
  if(!showSuccess&&(signingIn||version!==initialization))return false;
  if(showSuccess) {
    statusMessage('Login successful! Opening your dashboard...');
    try {sessionStorage.setItem('cacao-login-success','1');}catch{}
  }
  location.replace(roleHome(account.profile.role));return true;
}
$('login-form').addEventListener('submit',async event=>{
  event.preventDefault();if(signingIn)return;initialization++;
  const email=$('email').value.trim(),password=$('password').value;
  if(!email||!password)return statusMessage('Login failed. Enter your email address and password.',true);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return statusMessage('Login failed. Enter a valid email address.',true);
  if(!configured)return statusMessage('Login failed. '+loginError({}),true);
  if(!navigator.onLine)return statusMessage('Login failed. Connect to the internet before signing in.',true);
  signingIn=true;$('submit-auth').disabled=true;$('submit-auth').textContent='Signing in...';$('login-form').setAttribute('aria-busy','true');statusMessage('Checking your email and password...');
  try {
    if(typeof ensureDatabaseClient==='function')await ensureDatabaseClient();
    if(!db)throw new Error('The login library is unavailable. Reload this page or contact the administrator.');
    const {data,error}=await db.auth.signInWithPassword({email,password});if(error)throw error;
    sessionStorage.removeItem('cacao-logout-pending');localStorage.removeItem('cacao-logout-pending');
    if(!data.session?.user)throw new Error('No session was created.');
    await redirectSession(data.session,true);
  }catch(error){statusMessage('Login failed. '+loginError(error),true);}
  finally{signingIn=false;$('submit-auth').disabled=false;$('submit-auth').textContent='Log in';$('login-form').setAttribute('aria-busy','false');}
});
async function start() {
  const version=initialization;
  if(!configured)return statusMessage(loginError({}),true);
  if(!db){
    statusMessage('Loading the secure login service...');
    if(typeof ensureDatabaseClient==='function')await ensureDatabaseClient();
    if(!db)throw new Error('The login library is unavailable. Reload this page or contact the administrator.');
    if(!signingIn&&version===initialization)statusMessage('Login service ready. Enter your email and password.');
  }
  if(sessionStorage.getItem('cacao-logout-pending')||localStorage.getItem('cacao-logout-pending')) {
    if(!navigator.onLine)statusMessage('Connect to log in again after signing out.',true);
    return;
  }
  if(!navigator.onLine) {
    const saved=savedOfflineAccount();
    if(saved?.profile.role==='farmer'){location.replace('farmer/plantations.html');return;}
    return statusMessage('Connect to sign in. Offline field access requires a previously verified farmer account.',true);
  }
  const {data,error}=await db.auth.getSession();if(error)throw error;
  if(signingIn||version!==initialization)return;
  await redirectSession(data.session,false,version);
}
start().catch(error=>{if(!signingIn&&initialization===0)statusMessage(loginError(error),true);});
