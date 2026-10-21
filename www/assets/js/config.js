// EDIT THESE TWO VALUES. Only use a Supabase public publishable / anon key.
// NEVER paste your sb_secret or service_role key into website source files.
window.CACAO_SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
window.CACAO_SUPABASE_KEY = 'YOUR_PUBLIC_PUBLISHABLE_KEY';
const configured = /^https:\/\/[^/]+\.supabase\.co$/.test(window.CACAO_SUPABASE_URL) &&
  !window.CACAO_SUPABASE_URL.includes('YOUR-PROJECT') &&
  !!window.CACAO_SUPABASE_KEY && !window.CACAO_SUPABASE_KEY.includes('YOUR_') &&
  !window.CACAO_SUPABASE_KEY.startsWith('sb_secret');

// Configure only licensed imagery endpoints. Never paste secret provider keys here.
window.CACAO_MAP = {
  tiles: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
  imagery: null
};
