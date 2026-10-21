
/*
 * CACAO INDUSTRY
 * Supabase and Map Configuration
 *
 * Use ONLY the public Supabase publishable/anon key.
 * Never use sb_secret or service_role keys here.
 */

window.CACAO_SUPABASE_URL =
  "https://qirfqeprpbcnakztjfsj.supabase.co";

// Replace this with your PUBLIC publishable key.
window.CACAO_SUPABASE_KEY =
  "YOUR_PUBLIC_PUBLISHABLE_KEY";

// Check if Supabase is configured.
const configured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(
    window.CACAO_SUPABASE_URL
  ) &&
  typeof window.CACAO_SUPABASE_KEY === "string" &&
  window.CACAO_SUPABASE_KEY.length > 20 &&
  !window.CACAO_SUPABASE_KEY.includes("YOUR_") &&
  !window.CACAO_SUPABASE_KEY.startsWith("sb_secret");

// GPS / OpenStreetMap Configuration
window.CACAO_MAP = {
  tiles:
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

  attribution:
    "&copy; OpenStreetMap contributors",

  maxZoom: 19,

  imagery: null
};
