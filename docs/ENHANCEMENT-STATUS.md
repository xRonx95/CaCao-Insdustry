# Complete enhancement implementation

The requested enhancement brief is preserved in ENHANCEMENT-BRIEF.md. This is implemented pilot source with local verification; it has not been deployed or certified for production.

## Upgrade

Back up the existing project first. In a staging Supabase project with PostGIS and migrations 001–004 already installed, apply these files once in order:

1. sql/005_mapping_integrity.sql — farmer identity checks, readable farmer codes, immutable boundary/GPS history, surface-area overlap flags and administrator mapping reviews.
2. sql/006_agricultural_monitoring.sql — harvests, health records, tasks, maintenance, attendance and tree events.
3. sql/007_safe_sync.sql — transactional field submissions and idempotent receipts.

For a new project, apply 001–007 in order. These are migration scripts, not scripts to rerun on every startup. Do not rerun earlier migrations over a newer schema. Run tests/rls-staging.sql in staging as the database owner; its fixtures roll back. Resolve errors before rollout. No hosted SQL execution occurred during this implementation because project credentials and a PostgreSQL environment were unavailable.

## Features available

- Farmer codes use the entire UUID. Name/phone/date candidates are checked within the authorized registry; server validation also prevents duplicate nonempty RSBSA references. Existing duplicate legacy records are retained for reconciliation. Matching names alone require review and are not automatically merged.
- Plantation directory searches farm/farmer/location and filters barangay, farm status and mapping review, with pagination.
- GeoJSON Polygon, Feature, FeatureCollection and MultiPolygon imports preserve coordinates and offer parcel selection. Each plantation saves one exterior polygon; holes are explicitly rejected. Invalid rings are rejected. Current and historical boundaries can be exported.
- Walking GPS requires an encrypted recovery passphrase before tracking. Raw readings, accuracy, timestamps and exclusion reasons are retained separately from edited polygons. Autosave is device-local; saved server history cannot be rewritten through the application.
- PostGIS determines stored area and flags positive shared surface area, including containment. A shared edge alone is not a flag. Flags prompt review rather than rejecting the farmer. Neighbor identities are shown only when already accessible to the viewer.
- Boundary history, GPS sessions, registration events and administrator review notes have dedicated pages. Reviewing an old boundary opens a new edit; it does not delete intervening history. Administrator review checks the current revision.
- Harvests record pods, wet/dry weights, estimated PHP value and an area snapshot. Monthly/yearly/farm summaries keep wet and dry weights separate. Period productivity uses each participating farm's latest area snapshot in that period once, rather than adding the area for every harvest.
- Pest reports have separate append-only treatments and inspections. The latest dated inspection updates the report's current severity/resolution.
- Task schedules, maintenance history, assigned-worker attendance, planting/mortality/replacement events and optional individual tree tags have their own HTML/CSS/JS entry points. Attendance is staff-only and capped at 24 combined hours per worker/day. Tree events remain separate from inventory snapshots to avoid counting the same trees twice.
- Dashboards include production and GPS/review information from authorized database records. There are no fabricated operational records.

## Offline field workflow

1. Open the deployed HTTPS site or localhost online; log into the correct role.
2. Open Sync & recovery, choose a field-data passphrase of at least 12 characters and prepare field records. Preparation downloads only records the server permits. Complete the dependency preparation before disconnecting; a partial failure is reported.
3. Reopen field pages offline and unlock with that passphrase. The last verified account is usable locally for up to 24 hours; this does not grant server permissions.
4. Submit structured forms normally. A queued result means stored locally, not registered on the server. Inspect the queue to distinguish pending, conflict, attention, blocked and confirmed outcomes.
5. Reconnect with an unlocked workspace open. The client rechecks active account access and submits parents before dependent records. Each request has a durable identifier; the server stores its receipt in the same transaction as the record.
6. For conflicts, load the current server version and compare it with the retained local version. Boundary comparison includes overlays and exports. A revised submission requires an explicit choice and gets a new identifier; original ciphertext remains in history.

IndexedDB data is encrypted with AES-GCM and a PBKDF2-derived key held only in memory. Reloading requires unlocking again. Passphrases cannot be recovered. Browser storage clearing, browser eviction, device loss and forgotten passphrases can destroy unsynchronized work. Local encrypted storage is not a backup. The queue requires an open, unlocked page; this is not operating-system background synchronization.

The service worker caches allowlisted public application files/dependencies only. It does not cache Supabase API responses, private media, signed URLs, SQL or map tiles. Private downloaded records use the encrypted store. Photos/documents require online uploads; attach them after the parent record is confirmed. History detail queries and user administration require connectivity. Map tiles remain dependent on provider connectivity/licensing. The app can retain GPS readings without cached tiles, but that is not an offline basemap.

Sign out locks the local encryption key. Each account's queue remains isolated. Prepared data can become stale until refreshed; current assignment changes/suspension are enforced again when contacting the server.

## Validation and remaining acceptance

Nineteen automated Node tests pass, covering source links, account rejection, pagination, GPS checks, geometry import validation, duplicate candidates, production calculations, encryption, reload recovery, idempotent retry, conflict retention, account isolation, directory filters and service-worker API exclusions.

tests/browser-field.cjs uses an isolated local fixture server and real headless Chrome, IndexedDB, WebCrypto and service worker. It verifies mobile navigation/layout, offline harvest submission, reload/unlock, reconnect and a deliberately lost server acknowledgement without duplicate fixture records. The fixture service is test-only and is not a substitute for Supabase.

Before production: execute the staging PostGIS/RLS tests; test farmer A/B, assigned/unassigned staff and suspended accounts; verify private media paths; test concurrent edits and receipts against real PostgreSQL; test actual-phone GPS, signal loss, browser interruption and storage pressure; verify SMTP, recovery and invitations; review privacy/moderation, retention and backup restoration. Supabase keys remain placeholders. Native Android packaging, GPS permission integration, app signing and device QA remain unfinished. No remote deployment was performed.

After editing public HTML/CSS/JS/images, regenerate the shell manifest:

    node scripts/rebuild-offline-cache.cjs

All browser JavaScript remains in assets/js and styles in assets/css, with role-specific subfolders. Feature markup stays in admin, farmer and field. Shared behavior is deliberately centralized so a correction applies consistently across roles.
