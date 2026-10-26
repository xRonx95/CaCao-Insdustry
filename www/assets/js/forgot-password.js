// Recovery email request; Supabase handles tokens.
const form=document.getElementById('recovery-form');
const status=document.getElementById('recovery-status');
form.addEventListener('submit',async event=>{
  event.preventDefault();const button=document.getElementById('recovery-submit');button.disabled=true;
  try{
    if(!configured)throw new Error('Set your Supabase credentials in assets/js/config.js.');
    const {error}=await db.auth.resetPasswordForEmail(document.getElementById('recovery-email').value.trim(),{redirectTo:new URL('reset-password.html',location.href).href});
    if(error)throw error;status.className='status success';status.setAttribute('role','status');status.textContent='If this email is registered, a password recovery link has been sent.';
  }catch(error){status.className='status error';status.setAttribute('role','alert');status.textContent=error.message;}finally{button.disabled=false;}
});
