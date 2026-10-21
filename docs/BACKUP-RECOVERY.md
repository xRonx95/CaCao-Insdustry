# Backup and recovery runbook

Assign a named operator, backup schedule, retention window and acceptable data-loss/recovery targets before collecting production records.

## Before migrations

1. Pause production writes during the agreed migration window and record the deployed source version and last installed SQL migration.
2. Create a database backup using the project's configured Supabase backup/export facilities. Confirm the backup completed and can be retrieved. A copy of SQL migration files is not a database backup.
3. Back up Storage bucket objects separately, including farm-private and cacao-posts, preserving object paths and access configuration. Database metadata alone does not restore uploaded files.
4. Preserve Auth/provider configuration, redirect URLs, Edge Function source, origin settings and storage policies through approved secure administration procedures. Keep secrets in a managed secret store, never in the static website or source archives.
5. Store encrypted backup copies outside the application directory with restricted access. Record creation time, retention and integrity checks.

The source archives in backups/before-platform-expansion.zip and backups/before-complete-enhancement.zip contain source snapshots only. They contain no operational Supabase backup. The static deployment excludes backups.

## Restore exercise

Restore into an isolated staging project first. Use the supported restore process for the chosen backup type. Restore database data/schema and Storage objects, then reconfigure Auth and backend secrets for that staging origin. Avoid sending real invitation emails during the exercise.

Check row counts and representative records for farmer profiles, plantations, boundary versions, original GPS points, inventories, harvests, health history, workers, assignments, attendance, audit logs and sync receipts. Verify private file retrieval under the correct account and rejection under a different account. Confirm stored PostGIS area and boundary history. Run tests/rls-staging.sql only in staging and repeat real-account acceptance checks.

Sync receipts are essential recovery data: losing receipts while retaining their corresponding records can make a retried request appear new. Restore records and receipts to the same transactional recovery point. After any point-in-time restore, keep field clients disconnected until an operator reconciles unsynchronized queues and post-backup confirmations. Do not delete or blindly replay queues to repair a restore.

Record measured restore time and any lost interval, then compare with the agreed targets. A backup that has never been restored is not a completed recovery test.

## Rollout and rollback

Promote only after staging passes. Apply each pending migration once in order, then deploy its matching public assets and regenerated service worker. Check login, permissions, save/reopen, media and sync on the production HTTPS origin.

If a migration fails, preserve its error and stop the upgrade. The new migrations use transactions; check the actual schema state before retrying. Do not drop new tables, truncate audit history or rerun older schema scripts as a rollback shortcut.

If rollback requires a database restore, pause writes, preserve the failing state for investigation and follow the rehearsed recovery procedure. Coordinate the website version, database version and field-device queues before reopening writes.

Device-local encrypted drafts and downloaded snapshots are not included in server backups. Before planned device replacement or browser clearing, synchronize and verify confirmation for every pending entry while the account and passphrase are available.
