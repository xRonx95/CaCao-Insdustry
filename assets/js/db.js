// Shared Supabase access. Permissions are enforced by migration 004 RLS.
function accountRole(user) {
  const role = user?.app_metadata?.role;
  return ['super_admin','admin','field'].includes(role) ? role : 'farmer';
}
function roleHome(role, prefix = '') {
  const folder = role === 'super_admin' ? 'admin' : role;
  return prefix + folder + '/' + folder + '.html';
}
const db = configured && window.supabase ? window.supabase.createClient(window.CACAO_SUPABASE_URL, window.CACAO_SUPABASE_KEY) : null;
async function accountAccess() {
  if(!db)throw new Error('The account library is unavailable. Connect once to prepare this device for field work.');
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new Error('Your session has expired. Please log in.');
  const { data: profile, error: profileError } = await db.from('profiles').select('id,display_name,role,account_status').eq('id', user.id).single();
  if (profileError) throw new Error('Account access could not be verified. Run the platform database migrations. ' + profileError.message);
  if (!profile) throw new Error('Your account profile could not be found. Contact the system administrator.');
  if (profile.account_status !== 'active') throw new Error('This account is suspended. Contact the system administrator.');
  return { user, profile };
}
async function listAll(table, columns = '*') {
  if(table==='plantations'&&columns==='*')columns='id,owner_id,farmer_id,name,farmer_name,barangay,municipality,province,tree_count,variety,notes,boundary,area_sqm,created_at,updated_at,address,land_tenure,established_on,status,verification_status,revision,gps_accuracy,gps_samples,capture_method';
  if(typeof navigator!=='undefined'&&!navigator.onLine&&window.CacaoSync)return CacaoSync.cached(table);
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await db.from(table).select(columns).order('id').range(offset, offset + 499);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 500) {
      if(window.CacaoSync?.unlocked())await CacaoSync.cache(table,rows);
      return rows;
    }
  }
}
async function listPlantations() { return listAll('plantations'); }
async function savePlantation(record) {
  if(window.CacaoSync){
    const {id,revision,...payload}=record;
    return CacaoSync.submit({changeId:payload._change_id||crypto.randomUUID(),entity:'plantations',recordId:id||crypto.randomUUID(),revision:revision??null,payload:Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='_change_id'))});
  }
  const { user } = await accountAccess();
  const { id, revision, ...fields } = record;
  const query = id
    ? db.from('plantations').update(fields).eq('id', id).eq('revision', revision)
    : db.from('plantations').insert({ ...fields, owner_id: fields.owner_id || user.id });
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This plantation was changed by another user. Reload it and review their changes before saving. Your edits have not overwritten their record.');
  return data;
}
async function getRecord(table,id){
  if(!navigator.onLine&&window.CacaoSync){const record=(await CacaoSync.cached(table)).find(row=>row.id===id);if(!record)throw new Error('This record was not prepared for offline use.');return record;}
  const {data,error}=await db.from(table).select('*').eq('id',id).single();if(error)throw error;return data;
}
