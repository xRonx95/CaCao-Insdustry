# Release status and acceptance

The complete enhancement has been implemented locally. See [ENHANCEMENT-STATUS.md](ENHANCEMENT-STATUS.md) for the feature inventory, offline workflow, verified behavior and current limits, and [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md) for the recovery runbook.

## Acceptance sequence

1. Back up the existing project and prepare staging. Apply pending SQL files once in order through 007. Existing installations at 004 need only 005–007.
2. Run tests/rls-staging.sql as the staging database owner. It rolls back fixtures. Actual PostGIS/RLS execution has not yet been verified in this workspace.
3. Exercise real farmer A/B, assigned/unassigned field staff, administrator, super-admin and suspended accounts. Confirm row/file isolation and reject forged approvals and audit writes.
4. Register a profile and private image/document, link multiple plantations, import/draw/walk boundaries, review overlap flags, approve with a note and reopen immutable history. Check server area, shared-edge behavior and containment.
5. Record inventories, harvests, pests/treatments/inspections, tree events/tags, worker assignments, attendance, maintenance and task completion. Verify date, weight and hours constraints.
6. Use two sessions to produce a revision conflict. Compare current/local geometry, preserve the original draft and submit only the explicitly chosen revision.
7. Prepare offline records, reload and unlock, create related records offline, reconnect and verify exactly one confirmed server record per submission key. Test dropped confirmations, expired sessions and revoked staff scope.
8. Test actual-phone GPS, permission denial, low accuracy, interrupted tracking, storage pressure, reload recovery, mobile keyboard use and reduced motion on HTTPS.
9. Validate CSV/print output, production denominators and wet/dry separation against actual records. Verify signup/recovery/invitation SMTP and redirect configuration.
10. Complete privacy contact/retention, public-post moderation, monitoring and a staging backup restore. Android compilation/native permissions remain a separate unfinished delivery.

## Locally verified

Nineteen automated tests pass. The real Chrome fixture test passes for mobile navigation, encrypted IndexedDB, offline harvest reload/unlock, reconnect and retry after a lost confirmation without a duplicate fixture record. Earlier browser checks covered public pages, dashboards, registries, inventories, reports and mapping initialization. Test fixtures never enter operational source/data.

Supabase credentials remain placeholders. Hosted permissions, invitation delivery, physical GPS accuracy and production deployment have not been verified. No compiled Android application is supplied.
