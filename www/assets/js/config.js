
/*
 * CACAO INDUSTRY
 * Supabase and GPS Mapping Configuration
 *
 * Only use a public Supabase publishable key.
 */

window.CACAO_SUPABASE_URL =
  "https://qirfqeprpbcnakztjfsj.supabase.co";

// Public Supabase publishable key shared by the website and Android app.
window.CACAO_SUPABASE_KEY =
  "sb_publishable_WI0dXdbsMb68RoNUxZH5zw_7Xit_9mY";

// Validate Supabase configuration.
const configured =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(
    window.CACAO_SUPABASE_URL
  ) &&
  typeof window.CACAO_SUPABASE_KEY === "string" &&
  window.CACAO_SUPABASE_KEY.startsWith(
    "sb_publishable_"
  ) &&
  window.CACAO_SUPABASE_KEY.length > 20;

// GPS / OpenStreetMap
window.CACAO_MAP = {
  tiles:
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",

  attribution:
    "&copy; OpenStreetMap contributors",

  maxZoom: 19,

  imagery: null
};
