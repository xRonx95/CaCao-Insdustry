# Field staff profile approvals

Apply only pending numbered migrations in order through `sql/013_field_profile_reviews.sql`. Do not rerun the fresh-install bundle on an existing database. Migration 013 adds tables and RPCs; it does not change account roles, suspend accounts, or replace staff assignments.

- Field personnel open **Profiles & reviews → My field staff profile**, enter their own name, contact number, address and position, then submit for administrator review.
- Administrators and super administrators open **Profiles & reviews → Field staff approvals**, select a pending submission, and approve or request corrections with 10–2000 characters of written feedback.
- Field personnel can read their own status and review history. Saving corrected or updated details returns the profile to pending review.
- Farmer profiles continue through **Profile review inbox**. Administrators and super administrators approve; farmers and field personnel can submit or correct profiles but cannot approve them. Administrators do not need farmer assignments after migration 014. A super administrator manages field staff assignments in **Users & access**.

Tables allow authenticated reads according to role and ownership; direct client writes are revoked. RPCs enforce role checks, own-profile submission, pending-only decisions and optimistic version checks. Review history is written atomically with profile changes.

Run `npm.cmd test` and `node tests/browser-design.cjs` for local checks. Run `tests/field-profiles-staging.sql` against a disposable staging database after migrations 001–013 to check RLS, administrator decisions, stale versions, self-approval denial and direct-write denial. The staging script rolls back its fixtures. Hosted database verification is separate from local browser fixtures.
