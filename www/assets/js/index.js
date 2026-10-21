// Public feed: reading posts does not require a session.
const feed = document.getElementById('public-feed');
const statusElement = document.getElementById('feed-status');
const moreButton = document.getElementById('load-more');
let offset = 0;
let loading = false;
const pageSize = 12;
function publicPhoto(path) {
  return db.storage.from('cacao-posts').getPublicUrl(path).data.publicUrl;
}
function renderPost(post) {
  const card = document.createElement('article');
  card.className = 'post-card';
  if (post.image_path) {
    const photo = document.createElement('img');
    photo.src = publicPhoto(post.image_path);
    photo.alt = post.caption || 'Cacao photo shared by ' + post.farmer_name;
    photo.loading = 'lazy'; photo.className = 'post-photo';
    card.append(photo);
  }
  const content = document.createElement('div'); content.className = 'post-content';
  const name = document.createElement('h3'); name.textContent = post.farmer_name;
  const date = document.createElement('p'); date.className = 'post-meta';
  date.textContent = new Date(post.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const caption = document.createElement('p'); caption.textContent = post.caption;
  content.append(name, date, caption); card.append(content); feed.append(card);
}
async function loadFeed(reset = false) {
  if (loading) return;
  if (!configured) { statusElement.textContent = 'The cacao community feed is being set up. Please check back soon.'; return; }
  loading = true;
  document.getElementById('refresh-feed').disabled = true;
  moreButton.disabled = true;
  statusElement.textContent = 'Loading farmer posts...';
  try {
    const start = reset ? 0 : offset;
    const { data, error } = await db.from('cacao_posts')
      .select('id,farmer_name,caption,image_path,created_at')
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(start, start + pageSize - 1);
    if (error) throw error;
    if (reset) feed.replaceChildren();
    for (const post of data) renderPost(post);
    offset = start + data.length;
    moreButton.classList.toggle('hidden', data.length < pageSize);
    statusElement.textContent = offset ? '' : 'No cacao posts yet. Be the first farmer to share an update!';
  } catch (error) { statusElement.textContent = 'Could not load farmer posts. Please try Refresh. ' + error.message; }
  finally { loading = false; moreButton.disabled = false; document.getElementById('refresh-feed').disabled = false; }
}
document.getElementById('refresh-feed').addEventListener('click', () => loadFeed(true));
moreButton.addEventListener('click', () => loadFeed());
if (db) db.auth.getSession().then(({ data }) => {
  if (!data.session) return;
  const role = accountRole(data.session.user);
  document.getElementById('dashboard-link').href = roleHome(role);
  document.getElementById('dashboard-link').classList.remove('hidden');
  document.getElementById('share-link').href = role === 'farmer' ? 'farmer/posts.html' : roleHome(role);
}).catch(() => {});
loadFeed(true);
