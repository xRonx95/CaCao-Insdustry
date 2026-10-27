// Explain authenticated scope without broadening database permissions.
window.CacaoAccess=(()=>{
  const node=(tag,text)=>{const el=document.createElement(tag);el.textContent=text??'';return el;};
  function message(role,count){
    if(role==='farmer')return 'Your account shows only your own farm records. Share your farm account ID with your super administrator when requesting staff review.';
    if(role==='admin')return 'You can access all farmer records and plantations, review farmer profiles and field staff profiles, and approve plantation boundaries. Farmer assignments are not required for administrators.';
    if(role==='super_admin')return 'You can access all farmer records and review profiles. Manage roles, account status and field staff assignments in Users & access.';
    if(count===0)return 'No farmer accounts are assigned to this staff account. You can see records you own. A super administrator must grant assigned access before you can review another farmer’s plantations.';
    return 'Assigned access: '+count+' farmer account'+(count===1?'':'s')+'. Records remain limited to these assignments and records you own.';
  }
  async function refresh(account){
    const root=document.getElementById('page-content');if(!root)return;
    document.getElementById('workspace-access')?.remove();
    const section=node('details');section.id='workspace-access';section.className='workspace-access';
    const title=node('summary','Account access & review visibility'),copy=node('p','Checking account access…'),identifier=node('p','Account ID: '+account.user.id);identifier.className='workspace-account-id';
    section.append(title,copy,identifier);root.prepend(section);
    const help=node('a','Access troubleshooting');help.href='../help.html#staff-access';section.append(help);
    const role=account.profile.role;
    if(role==='super_admin'){const link=node('a','Manage staff assignments');link.href='users.html';section.append(link);}
    try{
      let count=null;
      if(role==='field'){
        const assigned=new Set();
        for(let offset=0;;offset+=500){
          const {data,error}=await db.from('staff_farmer_assignments').select('farmer_owner_id').eq('staff_id',account.user.id).order('farmer_owner_id').range(offset,offset+499);
          if(error)throw error;data.forEach(row=>assigned.add(row.farmer_owner_id));if(data.length<500)break;
        }
        count=assigned.size;
      }
      copy.textContent=message(role,count);
      if(count===0){section.open=true;section.classList.add('access-attention');}
    }catch{copy.textContent='Assignment access could not be checked. Reconnect and reload; ask your super administrator to verify this account’s assignments if records remain unavailable.';section.open=true;section.classList.add('access-attention');}
  }
  return {refresh,message};
})();
