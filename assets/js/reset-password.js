// Recovery-link password update; Supabase handles tokens.
const form=document.getElementById('recovery-form');
const status=document.getElementById('recovery-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=document.getElementById('recovery-submit');button.disabled=true;
  try{
    if(!configured)throw new Error('Set your Supabase credentials in assets/js/config.js.');
    const password=document.getElementById('new-password').value;
    if(password!==document.getElementById('confirm-new-password').value)throw new Error('Passwords do not match.');
    const {data,error:sessionError}=await db.auth.getSession();
    if(sessionError||!data.session)throw new Error('Open a valid recovery or invitation link from your email first.');
    const {error}=await db.auth.updateUser({password});if(error)throw error;
    await db.auth.signOut();form.reset();status.textContent='Password updated. You can now log in with your new password.';
  }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
});
