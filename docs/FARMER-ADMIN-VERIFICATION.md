# Farmer and administrator fixes — 2026-10-27

## Screenshot findings

The farmer screenshot contains a saved manual boundary. A manual polygon has no GPS walking session unless GPS capture was separately saved. The administrator screenshot shows an empty authorized result, which can occur when no farmer accounts are assigned to that administrator. It does not establish that the farmer's data is missing.

The hosted assignments were not inspected or changed. The deployed pages could not be retrieved from this environment during verification.

## Changes

- Added Account access & review visibility to protected workspaces. It shows the signed-in account ID and checks only that staff member's permitted assignment rows.
- An unassigned administrator receives an actionable explanation. No blanket access policy or self-assignment permission was added.
- Empty boundary history disables its empty selector and hides the unused map and history panels.
- Refresh history now reloads the authorized plantation directory, not just the old selected row. A newly assigned farmer's plantation can appear without signing out.
- Manual boundaries explain why there is no GPS walking history.
- Super-administrator assignment selectors show names, roles and account IDs. Only active administrator/field accounts and active farmer accounts can be selected for a new assignment.
- Account-role changes rebuild those selectors, and assignment lists paginate instead of silently stopping at a default API limit.
- Tree inventory history refreshes after reconnection and confirmed synchronization. Save-confirmation messages distinguish a successful save from a later history-loading failure.

## Verified locally

- 88 automated tests passed with `node --test --test-concurrency=1 tests/*.test.cjs`.
- `tests/browser-workspaces.cjs` checked startup errors and responsive overflow on 91 authorized farmer, field, administrator and super-administrator screens using isolated fixtures.
- Browser tests covered account layouts and contrast; farmer profile selection; mapping-tab round trips; administrator decisions; empty administrator access; refreshed plantation assignments; batch stages; and offline encrypted inventory recovery and synchronization without duplicate records.
- Release build and local asset/navigation checks passed. The source and prepared Android web bundle were updated. No APK was installed or published.

## Remaining live setup

1. Redeploy the prepared web release.
2. A super administrator opens Users & access, selects the administrator and the actual farmer account, and grants assigned access. Compare their account IDs if display names are ambiguous.
3. The administrator chooses Refresh history. Confirm the saved plantation, boundary versions and review feedback with the real accounts.
4. Verify any pending numbered SQL migrations in staging, including migration 010 for the separate batch feature. Fixture tests do not apply or verify hosted SQL.

Do not replace the assigned-access policy with unrestricted farmer access merely to fill an empty dropdown. A missing assignment must be corrected by an authorized super administrator or database operator.
