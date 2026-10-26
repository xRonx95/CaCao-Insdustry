# CaAPs release and presentation readiness

Local automated checks use isolated fixtures. They do not prove that the hosted database, email delivery or Android device permissions work. Do not use real farmer information during a public demonstration.

## Release contents

- Farmer home: account-owned plantation links, profile-review updates, harvest summary and treatment follow-ups.
- Getting-started checklist derives its status from actual accessible records. English and Filipino are supported for this checklist; the rest of the workspace remains English.
- Harvest reports already support plantation/date filters, CSV export and Print / Save PDF.
- Help and field guide: `help.html`.
- Static, explicitly fictional presentation sample: `demo.html`. It makes no database writes and is not a live GPS or approval demonstration.
- Failed dashboard detail requests are displayed as unavailable, independently of successful sections.

## Live acceptance checks — still require verification after deployment

Use separate staff and farmer test accounts in a test environment. Record the build, date, device and result for each check.

1. Create a farmer account. Verify the configured email-confirmation behavior and password recovery, including an expired recovery link. Do not publish recovery links or passwords.
2. Submit a profile. Sign in as authorized staff, request a correction with feedback, then resubmit as the farmer and approve as staff. Verify the history and ensure another farmer cannot read that profile.
3. Register a plantation using the farmer account. Open mapping, reject location permission once and verify usable guidance. Allow location, capture a valid boundary, finish and return, save, reload and confirm the saved owner, shape and area.
4. Separately verify boundary review and the boundary revision history. Profile approval does not imply boundary verification.
5. Record a tree inventory and a harvest. Reload, filter the report by plantation/date and confirm kilograms, totals and CSV/PDF contents against the saved records.
6. Prepare offline pages and records, unlock field data, disconnect and save a tree inventory. Reopen, unlock, reconnect, synchronize and verify one server record. Do not expect offline harvest saving; offline writes support mapping and inventories only.
7. Create competing edits from two sessions. Confirm the conflict retains the draft and requires review. Do not overwrite it automatically.
8. Publish an intentionally public test post after selecting the confirmation checkbox. Verify private profiles and farm records do not appear on the community page.
9. Deploy a visual change, reopen the installed web app and verify the update notice. Keep a form draft intact until the user chooses to reload. Existing bundled APKs require a new native release to receive bundled changes; installed web apps receive deployed web updates.
10. Test Android GPS outdoors, poor reception, a small screen, keyboard navigation, and English/Filipino instructions with a farmer. Check all visible text, including error messages.

## Operations — not configured by these local changes

- Verify hosted SQL migrations 001–009, RLS and storage policies before the live acceptance run. Applying a migration is separate from passing a local fixture test.
- Configure password-recovery redirect URLs for the real deployed origin in the authentication provider. Confirm email delivery with a test mailbox.
- Assign a named staff support contact in the deployment's operating instructions; the help page deliberately does not invent a phone number or mailbox.
- Confirm the hosting/database backup capability for the active plan. Perform a restore into a separate test database and record the recovery result before claiming that restoration is proven.
- Configure an error-monitoring destination with restricted access and redact credentials, recovery URLs, GPS coordinates and private farmer fields. No external monitoring account has been connected by this change.
- Keep service-role credentials out of browser assets. Retain the release build and migration version used for each deployed release.

## Pitch walkthrough

1. State the problem: scattered farmer profiles, uncertain farm boundaries and disconnected production records.
2. Show the farmer home and checklist using the separate demonstration account.
3. Show profile feedback, a saved mapped plantation, inventory, harvest and filtered report.
4. Demonstrate a real offline inventory receiving a synchronization confirmation.
5. Explain who may see private records and which updates the farmer intentionally publishes.
6. Clearly distinguish measured results from intended benefits. Use the fictional sample only when presenting example figures.

## Batch acceptance checks after migration 010

- Apply 010 once after the existing migrations in staging and run tests/batches-staging.sql. Keep the rollback test separate from production migrations.
- Record a harvest with a wet weight and create two batches whose total allocation fits that harvest. Confirm an allocation beyond it is rejected, including competing submissions from two sessions.
- Follow fermentation ? drying ? quality hold. Confirm storage is blocked. Record a repeat quality pass, then storage and a whole-batch sale.
- Verify stale revisions, future dates, increasing weights, partial sales and direct history edits are rejected.
- Confirm another farmer and unassigned staff cannot read or write the batches, while explicitly assigned staff retain authorized access.
- Interrupt a response after saving and retry the same submission. Confirm one batch/event rather than a duplicate, then export and print the history.
- Batch records require connectivity; they are not added to the offline outbox. No QR labels, mixed/split batches or payment accounting are included in this release.
