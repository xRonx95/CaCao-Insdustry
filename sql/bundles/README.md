# Copy/paste SQL for Supabase

Choose exactly one route:

- **New, empty Supabase project:** open fresh-install.sql, select all, copy and paste into Supabase Dashboard → SQL Editor → New query. Run as the postgres database role. It includes migrations 001–009, PostGIS, tables, indexes, functions, triggers, row-level security and Storage bucket policies.
- **Existing project already at migration 004:** back up, then use upgrade-from-004.sql once. This contains migrations 005–009.
- **Any other installed migration level:** use only the remaining individual numbered SQL files from the parent sql folder, in ascending order.

Do not run both bundles. They check for incompatible existing application tables before starting. Stop on an error and record the message; do not repeatedly rerun the complete setup. Separate migration sections commit individually, so an error does not imply that every preceding section rolled back.

These files assemble the current application migrations; they have not been executed against a hosted Supabase project in this workspace.

After successful database setup:

1. Put your Supabase project URL and public publishable/anon key into assets/js/config.js.
2. Create your own account through the website signup form and verify its email.
3. Bootstrap that account as the first super administrator using the SQL below. Replace YOUR_EMAIL with your actual signup email. Run it as postgres; never run this through the browser.

    begin;
    update public.profiles
    set role = 'super_admin', account_status = 'active'
    where id = (select id from auth.users where email = 'YOUR_EMAIL');

    update auth.users
    set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
      || '{"role":"super_admin"}'::jsonb
    where email = 'YOUR_EMAIL';
    commit;

4. Sign out, then sign in again. Use Users & access to manage staff roles and farmer assignments.
5. Configure Auth Site URL/redirect URLs and SMTP separately. Deploy invite-team separately when invitations are needed; SQL cannot deploy that TypeScript function. See docs/EDGE-FUNCTION-SETUP.md.

Regenerate these bundles after editing a canonical migration:

    node scripts/bundle-database.cjs

Do not paste tests/rls-staging.sql into production setup; it contains test fixtures for an isolated staging project.

For an existing installation at 007 or 008, apply only pending migrations 008 and 009 from the parent folder. Run `tests/reviews-staging.sql` in staging after installing 009. Existing review clients must reload after 009 because direct profile approval writes are now rejected.
