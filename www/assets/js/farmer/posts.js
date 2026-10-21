// Farmer post composer with optional public photo upload.
let previewUrl;
const allowedTypes = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
function validatePhoto(file) {
  if (!file) return;
  if (!Object.hasOwn(allowedTypes, file.type)) throw new Error('Choose a JPEG, PNG or WebP photo.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Photo must be 5 MB or smaller.');
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  $('photo-preview').removeAttribute('src');
  $('photo-preview').classList.add('hidden');
}
$('photo').addEventListener('change', () => {
  clearPreview();
  try {
    const file = $('photo').files[0]; validatePhoto(file);
    if (file) {
      previewUrl = URL.createObjectURL(file);
      $('photo-preview').src = previewUrl;
      $('photo-preview').classList.remove('hidden');
    }
    notify('post-status', '');
  } catch (error) { $('photo').value = ''; notify('post-status', error.message, true); }
});
$('post-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('publish-post');
  let uploadedPath = null;
  let published = false;
  button.disabled = true;
  try {
    const farmerName = $('farmer-name').value.trim();
    const caption = $('caption').value.trim();
    const file = $('photo').files[0];
    if (!farmerName) throw new Error('Enter your farmer name.');
    if (!caption && !file) throw new Error('Write an update or choose a cacao photo.');
    validatePhoto(file);
    const { data: { user }, error: userError } = await db.auth.getUser();
    if (userError || !user) throw new Error('Please log in again before posting.');
    if (file) {
      notify('post-status', 'Uploading photo...');
      const filePath = user.id + '/' + crypto.randomUUID() + '.' + allowedTypes[file.type];
      const { error } = await db.storage.from('cacao-posts').upload(filePath, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      uploadedPath = filePath;
    }
    const { error } = await db.from('cacao_posts').insert({ owner_id: user.id, farmer_name: farmerName, caption, image_path: uploadedPath });
    if (error) throw error;
    published = true;
    $('post-form').reset(); $('farmer-name').value = farmerName; clearPreview();
    notify('post-status', 'Published! Your cacao post is now visible on the public home page.');
  } catch (error) {
    let cleanupMessage = '';
    if (uploadedPath && !published) {
      try {
        const { error: cleanupError } = await db.storage.from('cacao-posts').remove([uploadedPath]);
        if (cleanupError) cleanupMessage = ' The unused uploaded photo could not be removed.';
      } catch { cleanupMessage = ' The unused uploaded photo could not be removed.'; }
    }
    notify('post-status', error.message + cleanupMessage, true);
  } finally { button.disabled = false; }
});
async function startPosts() {
  if (!await requireSession()) return;
  const { data, error } = await db.auth.getUser();
  if (error) throw error;
  $('farmer-name').value = data.user.user_metadata?.full_name || '';
}
startPosts().catch(error => notify('page-status', error.message, true));
window.addEventListener('pagehide', clearPreview);
