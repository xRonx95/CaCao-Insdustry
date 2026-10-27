# Boundary history and review behavior

- Farmers load plantations with `owner_id` equal to their authenticated account ID. A second client ownership check prevents unrelated rows from entering the selector.
- Administrators use the existing row-level security and staff assignments to load only authorized plantations. The interface does not infer authority from a URL parameter.
- Boundary revisions, GPS sessions, overlap flags and administrator decisions are fetched with the selected plantation ID. GPS points are fetched through a session from that selected plantation.
- Changing plantations immediately clears old results and GPS samples. Selection tokens prevent late responses from restoring the previous plantation's data.
- Only admin and super_admin accounts may submit verification or rejection. Field staff and farmers have read-only review access. The existing `review_plantation` RPC in migration 005 independently checks the authenticated database role, authorized owner scope and expected revision.
- Farmers see current verification status and administrator feedback, plus historical decisions. When a boundary returns to pending, earlier decisions remain labeled as history.
- Previewing an old boundary hides review controls. Refresh history restores the current boundary before reviewing.
- No new migration is needed for these boundary-screen changes when migrations 001-009 are already installed. The separate batch-tracking feature requires migration 010.

Local tests: `tests/boundary-history.test.cjs` and the history scenarios in `tests/browser-design.cjs`. Browser fixtures verify interface behavior, not hosted database policies. Run the existing staging RLS tests and verify authorized accounts after deployment.
