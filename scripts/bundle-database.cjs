// Build copy/paste SQL bundles from the canonical ordered migrations.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = [
  '001_schema.sql', '002_admin_access.sql', '003_public_posts.sql',
  '004_platform.sql', '005_mapping_integrity.sql',
  '006_agricultural_monitoring.sql', '007_safe_sync.sql',
  '008_farmer_feature_limits.sql', '009_farmer_reviews.sql'
];
const output = path.join(root, 'sql', 'bundles');
fs.mkdirSync(output, { recursive: true });
function combine(selected) {
  return selected.map(file => '\n-- ============================================================\n-- ' + file + '\n-- ============================================================\n\n' +
    fs.readFileSync(path.join(root, 'sql', file), 'utf8').trim() + '\n').join('\n');
}
const freshHeader = '-- CACAO INDUSTRY: COMPLETE DATABASE SETUP (001 through 009)\n' +
  '-- For a NEW Supabase project only. Run once as postgres in SQL Editor.\n' +
  '-- Includes tables, functions, triggers, RLS, indexes and Storage buckets/policies.\n' +
  '-- Does not create Auth users, configure SMTP, or deploy the invite-team function.\n' +
  '-- Stop on any error. Never run this bundle over an existing installation.\n\n' +
  "do $$ begin\n  if to_regclass('public.profiles') is not null or to_regclass('public.farmers') is not null or to_regclass('public.plantations') is not null then\n" +
  "    raise exception 'Existing application tables detected. Apply only pending numbered migrations; do not run the fresh-install bundle.';\n  end if;\nend $$;\n";
const upgradeHeader = '-- CACAO INDUSTRY: UPGRADE FROM 004 TO 009\n' +
  '-- Only for projects with 001 through 004 already successfully installed.\n' +
  '-- Back up first. Test in staging. Apply once; do not rerun installed migrations.\n' +
  '-- If any part of 005-009 is already installed, use only the pending numbered files.\n\n' +
  "do $$ begin\n  if to_regclass('public.staff_farmer_assignments') is null or to_regprocedure('public.set_account_access(uuid,text,text)') is null then\n" +
  "    raise exception 'Migration 004 must be installed first.';\n  end if;\n" +
  "  if to_regclass('public.mapping_reviews') is not null or to_regclass('public.harvests') is not null or to_regclass('public.sync_receipts') is not null then\n" +
  "    raise exception 'An enhancement migration is already installed. Apply only remaining numbered migrations.';\n  end if;\nend $$;\n";
fs.writeFileSync(path.join(output, 'fresh-install.sql'), freshHeader + combine(files));
fs.writeFileSync(path.join(output, 'upgrade-from-004.sql'), upgradeHeader + combine(files.slice(4)));
console.log('Created fresh-install.sql (001-009) and upgrade-from-004.sql (005-009).');
