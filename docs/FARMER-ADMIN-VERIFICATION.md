# Administrator access and review visibility

Migration 014 supersedes the earlier assignment requirement for administrators. Admin and Super Admin accounts can access all operational farmer records, plantations, boundaries, batch history, documents and profile reviews. Field staff still need assignments to access another farmer's records. Farmers remain limited to their own accounts.

Apply only pending numbered migrations in order through sql/014_admin_operational_access.sql, deploy the web release, then choose Refresh history. Administrators should see a message confirming access without assignments. If the directory is empty, check filters, the configured Supabase project, and whether migration 014 was applied. Changing only the displayed message cannot grant database access.

Only super administrators can change roles, account status, invitations or field staff assignments. Existing administrator assignments do not narrow administrator access.

Local validation uses automated tests and isolated browser fixtures. Run tests/admin-access-staging.sql on a disposable database after 001?014 to verify actual administrator access, profile approval without assignments, field isolation, suspended-account denial and restrictions on account management. The script rolls back its fixtures. Live database verification and deployment must be performed separately.

A manual plantation boundary has no GPS walking session unless GPS capture was separately saved.
