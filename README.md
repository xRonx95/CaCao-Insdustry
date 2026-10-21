# CACAO INDUSTRY

Farmer Profiling and GPS Plantation Mapping System for Isabela City, Basilan, Philippines.

An independent cacao registry, not an official DA, PSA or RSBSA service. The web application uses plain HTML, CSS and JavaScript with Supabase. No frontend build step is required.

## Start here

1. Back up your database. Existing source files were archived at `backups/before-complete-enhancement.zip` before this expansion.
2. In a **staging Supabase project**, enable PostGIS, then run these SQL files in order:
   - `sql/001_schema.sql`
   - `sql/002_admin_access.sql`
   - `sql/003_public_posts.sql`
   - `sql/004_platform.sql`
   - `sql/005_mapping_integrity.sql`
   - `sql/006_agricultural_monitoring.sql`
   - `sql/007_safe_sync.sql`

   If 001–004 are already installed, apply only 005–007, once, in order. Review staging results before upgrading production.
3. Edit `assets/js/config.js` with your project URL and public publishable/anon key. Never enter a service-role or secret key. The static site does not read Vercel environment variables or `.env` automatically.
4. Open `index.html` through VS Code Live Server. The public community feed is available before login. Use `signup.html` to create a farmer account.
5. Verify the signup email if confirmation is enabled. Supabase Auth redirect URLs must allow `login.html` and `reset-password.html` on the exact local/deployed origin you use.
6. Bootstrap your first super administrator using the SQL examples at the bottom of `004_platform.sql`. Sign out and sign back in. Later role/status changes and staff assignments are managed in **Users & access**.
7. Run `tests/rls-staging.sql` in staging and complete the acceptance checks in [docs/RELEASE-STATUS.md](docs/RELEASE-STATUS.md) before using real personal data.

Migration 004 replaces the old unrestricted admin bypass. Administrators and field personnel see their own records plus farmer accounts explicitly assigned by a super administrator. Super administrators see all private operational records. Account roles/status come from protected database profiles; user-editable metadata cannot grant permission.

## Main pages and folders

| Location | Purpose |
| --- | --- |
| `index.html` | Public cacao posts and photos |
| `about.html`, `impact.html` | Platform introduction and intended benefits |
| `login.html`, `signup.html` | Separate authentication screens |
| `forgot-password.html`, `reset-password.html` | Password recovery and invitation password setup |
| `privacy.html` | Operational privacy notice; organization details must be finalized before launch |
| `admin/admin.html` | Admin/super admin overview |
| `farmer/farmer.html` | Farmer overview |
| `field/field.html` | Field personnel overview |
| Each role folder | Farmer profiles, plantations, tree inventories, workers, assignments, GIS map, reports and activity log |
| `admin/users.html` | Super admin invitations, role/status changes and staff access assignments |
| `farmer/posts.html` | Publish a text update, cacao photo, or both |
| `assets/css/<role>/` | Each feature's role-specific CSS |
| `assets/js/<role>/` | Each feature's role-specific JavaScript entry point |

HTML remains in role folders. CSS and browser JavaScript remain under `assets/css` and `assets/js`. Shared implementations avoid maintaining three separate permission/data systems:

- `assets/css/style.css`: common controls, typography and layout.
- `assets/css/ui.css` and `assets/js/ui.js`: motion, hover/focus feedback and reduced-motion support.
- `assets/css/platform.css` and `assets/js/workspace.js`: desktop sidebar, mobile menu, tables and printable layout.
- `assets/js/db.js`: account access, paginated database reads and optimistic plantation updates.
- `assets/js/session.js`: protected-page session/account checks and logout.
- `assets/js/platform.js`: shared registries, dashboards, GIS overview, reports and user management.
- `assets/js/gps-mapping.js`: continuous GPS walking, manual polygons and mapping-frame communication.
- `assets/js/drafts.js`: passphrase-encrypted IndexedDB mapping/profile drafts.
- `assets/js/record-integrity.js` and `enhancements.js`: duplicate checks, GeoJSON import/export, boundary/GPS history and mapping review.
- `assets/js/module-definitions.js` and `monitoring.js`: harvests, pests, treatment/inspection history, task schedules, maintenance, attendance and tree events/tags.
- `assets/js/sync.js`, `sync-page.js` and `assets/css/sync.css`: encrypted outbox, downloaded records and conflict review.
- `assets/js/plantation-directory.js`: shared search, filters and pagination.
- `service-worker.js`: generated public offline shell. Run `node scripts/rebuild-offline-cache.cjs` after editing public assets.
- `images/cacao.png`: logo; `favicon.ico`: multi-size browser icon.

## Operational workflow

1. Create a farmer account, or have an authorized staff member register a farmer profile under the appropriate owner account. Record required names, address, barangay and contact details. Photos/supporting files are private.
2. An assigned administrator or super administrator reviews and approves the profile. Farmer edits to substantive profile information return it to pending review.
3. Register a plantation and select its farmer profile. A farmer can have multiple plantations, each with its own boundary. Existing legacy plantations without a farmer link can be linked from the form without deleting them.
4. Draw a polygon manually or use **Start GPS mapping**. Walk the perimeter; Pause/Resume as needed; Finish and review the polygon with the edit tool. The map skips low-accuracy readings, rejects near-duplicate points, checks self-intersections, and retains accepted point accuracy/timestamps.
5. Save the farm. PostGIS validates geometry and calculates the stored area. Turf.js provides the map preview. Small preview/server differences are expected because their geographic area models differ. Areas are approximate, not legal cadastral surveys.
6. Record dated tree inventories. Seedlings + young + mature + dead form the total; productive/non-productive partition the mature count. History is append-only; the latest dated inventory updates the plantation total.
7. Staff maintain worker records and assign workers to one or more plantations owned by the same farmer account. Farmers can view their workers and assignments.
8. Open GIS Map for authorized boundaries and filters. Open Reports for farmer, plantation, inventory, worker, barangay, status, distribution and annual registration summaries. CSV export uses the current filters; **Print / Save PDF** uses the browser print dialog.

Annual reports group current recorded plantation totals by registration year. They do not claim to reconstruct historical yield, income or past land-area snapshots. The tree trend shows latest known inventory totals; it is not a measured growth/yield model.

## Media, GPS and drafts

- Public cacao posts use `cacao_posts` and the public `cacao-posts` bucket. Private profiles, worker photos, supporting documents and farm photos use `farm-private` with short-lived signed links.
- Images: JPEG, PNG or WebP, maximum 5 MB. Supporting documents may also be PDF. Server bucket policies enforce MIME/size restrictions and owner-scoped access.
- GPS requires HTTPS or localhost. The engine uses `watchPosition`, high accuracy, a configurable 5–100 m error threshold, 3 m minimum point spacing and at most 10,000 accepted points. Tracking pauses when the page is hidden and watchers are cleared when tracking stops or the page closes.
- Default tiles are OpenStreetMap. Configure only licensed imagery in `CACAO_MAP`; update the deployment CSP allowlist for additional provider endpoints. Online tiles/CDN libraries require network access.
- Farmer drafts and GPS drafts are opt-in, encrypted with AES-GCM using a passphrase-derived key. Passphrases/keys are not saved. Losing a passphrase makes that draft unrecoverable. Select photos again after restoring a profile draft.
- After enabling a GPS draft, point changes autosave while that mapping frame remains open. Drafts are device-local; delete them on shared devices. A new device/browser cannot restore them.
- The public application shell is cached by a service worker. Open **Sync & recovery**, unlock field data and prepare authorized records/dependencies while online before field work. Pending structured submissions are encrypted in IndexedDB and retried while an unlocked page is open and online. Stale revisions require explicit conflict review; no silent boundary overwrite. See [offline workflow and limitations](docs/ENHANCEMENT-STATUS.md).
- Offline access uses the last locally verified account for at most 24 hours and still requires the field-data passphrase. Every synchronization rechecks the active account and assigned scope on the server. Photos/documents and uncached map tiles require connectivity; browser storage clearing removes device-local drafts.

## Staff invitations

For editor errors around Deno or SDK imports, see [Edge Function setup](docs/EDGE-FUNCTION-SETUP.md). This backend TypeScript file requires the Deno runtime/editor extension; it is separate from browser JavaScript.

Deploy the backend function after configuring Supabase CLI:

```sh
supabase secrets set ALLOWED_ORIGIN=https://your-production-domain.example
supabase functions deploy invite-team --no-verify-jwt
```

The function explicitly validates the bearer session and protected super-admin profile before using its server-side service credential. `--no-verify-jwt` allows that explicit handler to verify the user; it does not make invitation operations anonymous. Supabase supplies its hosted function credentials. Configure `ALLOWED_ORIGIN` for your actual deployment and allow its `reset-password.html` redirect in Auth settings. Configure a working SMTP sender before inviting real users.

If an invitation succeeds but role assignment fails, the response identifies the partial result. Review that account in Users; it starts as a farmer and is not silently granted elevated privileges.

## Validation

```sh
node --test tests/platform.test.cjs tests/enhancements.test.cjs tests/offline-sync.test.cjs tests/offline-shell.test.cjs
node tests/browser-field.cjs
```

These local checks cover asset links/script compatibility, role routing/account rejection, stale-edit protection, pagination beyond 500 rows, GPS input checks, CSV formula escaping and encrypted draft behavior. They do not execute PostGIS/RLS in Supabase. `tests/rls-staging.sql` contains transaction-rolled-back database assertions for staging.

Headless Chrome checks covered desktop/mobile rendering, mobile navigation, mapping initialization and runtime exceptions. A protected-page layout was inspected without account data. Additional browser flows used isolated in-memory fixtures for dashboard calculations, registries, profile editing, inventory submission, reports and plantation selection. These are not successful live Supabase login/RLS tests.

## GitHub and Vercel

1. Review local changes, exclude backups/secrets, create a Git repository and push it to your chosen GitHub repository. No repository has been created or published automatically.
2. Import the repository into Vercel as an **Other / static** project. Leave the build command empty and serve the project root. `vercel.json` supplies security headers; `.vercelignore` excludes backend files, SQL, docs, tests and backups from the static deployment.
3. Set the real public Supabase values in `assets/js/config.js` before deployment. Public keys are intentionally browser-visible; RLS protects data.
4. Set the HTTPS deployment URL in Supabase Auth Site URL and allowed redirects, deploy `invite-team` separately, then repeat acceptance checks on the deployed site.
5. Configure the organization's privacy contact/retention policy, backups and operational monitoring before collecting production personal information.

## Android preparation

`capacitor.config.json` points to `dist`. `scripts/prepare-android.ps1` copies only public web assets into that folder. This is preparation, not a compiled or tested Android application.

Follow [Capacitor installation](https://capacitorjs.com/docs/getting-started) and its [environment setup](https://capacitorjs.com/docs/getting-started/environment-setup) to install compatible core/CLI/Android packages, then add Android and run `npx cap sync android` after preparing the bundle. Native location permission handling, WebView origin/auth redirects, secure draft key storage, offline dependencies and actual-device GPS behavior must be implemented/tested before shipping an APK.

## Technical references

Implementation follows [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [PostGIS on Supabase](https://supabase.com/docs/guides/database/extensions/postgis), [password recovery](https://supabase.com/docs/guides/auth/passwords), [private storage access](https://supabase.com/docs/guides/storage/security/access-control), [server-side user management](https://supabase.com/docs/guides/auth/users) and [PostGIS geometry validation](https://postgis.net/docs/ST_IsValid.html).

The source briefs are preserved at `docs/PROJECT-BRIEF.md` and `docs/ENHANCEMENT-BRIEF.md`. See [enhancement status](docs/ENHANCEMENT-STATUS.md) and [backup/restore runbook](docs/BACKUP-RECOVERY.md). See `docs/RELEASE-STATUS.md` for the remaining launch work. This repository is a pilot implementation, not a production certification.
