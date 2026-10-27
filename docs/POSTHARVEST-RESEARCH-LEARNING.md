# CaAPs: post-harvest quality and Research Learning

## Scope delivered

The primary signed-in workspace is now the role-specific postharvest page. Branding and new-entry defaults focus on the supplied Zamboanga del Norte challenge. Existing farms and their stored locations are retained; they are not relabeled as belonging to a new province.

| Challenge | Software response | Limit |
|---|---|---|
| Inconsistent practices | Staff-recorded buyer/adviser protocol, start time and targets | Requires a real agreement and trained staff |
| Fermentation | Manual temperature and turning observations; configured reminders | No automatic sensor or remote control |
| Drying | Moisture, method, conditions and protection records; trend chart | Tools and facilities remain external |
| Premium quality | Cut-test sample, moisture and assigned staff grade | Not independent certification or buyer acceptance |
| Standardized handling | Facility/cooperative handover ledger | Typed recipient is not an acceptance signature |
| Farmer income | Recorded sale price/kg, logged processing cost/kg, sales less those costs | Excludes unlogged/farming costs; no verified income uplift |
| Evidence and learning | Immutable records, auditable corrections, CSV and print | Pilot comparisons require comparable batches and careful interpretation |

Farmers may record ungraded quality observations. Assigned field/admin/super-admin accounts record the agreed protocol and final grades within their authorized scope. Farmers cannot overwrite a staff-reviewed grade or protocol. The role alone does not establish professional competence; training and reviewer selection are pilot responsibilities.

The storage guard requires the actual protocol and latest effective quality assessment. It checks the configured minimum fermentation duration, moisture limits, sample defects and grade. Existing stored batches are not retroactively altered. New storage transitions must satisfy the new guard.

Financial and quality indicators use authorized records only. A corrected cost is counted once. Ungraded batches do not become a zero-percent downgrade claim. Assessed-weight figures use the latest effective graded record's batch-weight snapshot; they are not automatically comparable with the poster's sector-wide percentage.

## Rollout

1. In staging, apply only pending migrations in order, through 010 and 011. Never run the fresh-install bundle on an existing installation.
2. Run `tests/postharvest-staging.sql` with a privileged staging database account. This rollback-only test exercises scope, grading permissions, storage evidence, receipts and corrections. It has not been executed against a hosted database by this local implementation.
3. Use `tests/batches-staging.sql` for the 010-only schema. After 011, use the post-harvest staging test because storage intentionally requires additional evidence.
4. Deploy the prepared release and confirm auth redirects, real role assignments, browser/mobile measurements and exports.
5. Train reviewers and farmers; confirm tools and protocols with a cooperative and intended buyer before a real pilot.

Post-harvest observations are online-only. Existing offline mapping and tree inventories are retained. No new APK was installed; the prepared `www` bundle is separate from an already installed APK. Installed web apps receive deployed web changes through the existing update flow.

## Five-minute Research Learning pitch

The user defined RLE as Research Learning. No institutional scoring rubric was provided, so the pitch follows problem → research evidence → prototype → validation limits → pilot measures → learning loop → partnership request.

- `docs/pitch/CaAPs-Research-Learning-Pitch.pptx`: 11 editable slides with speaker notes; 10 timed slides total 300 seconds, plus a source appendix.
- `docs/pitch/CaAPs-Research-Learning-Pitch.pdf`: visual handout.
- `docs/pitch/Speaker-Notes.md`: spoken script and timing (about 680 words).
- `docs/pitch/Pitch-Preview.html` and `docs/pitch/slides/`: matching browser-rendered previews.

The PowerPoint is built directly as an Open XML package with native editable text/shapes and embedded images. Office automation could not start in this session. Package XML, relationships, slide and note counts were validated; browser/PDF previews were visually inspected. Native PowerPoint rendering was not available for inspection.

Rebuild after capturing a new fictional screenshot in `docs/previews/postharvest-workspace.png`:

```
node scripts/pitch-content.cjs
node scripts/build-pitch-openxml.cjs
node scripts/render-pitch.cjs
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/validate-pitch.ps1
```

The slide sample uses fictional data, and the pilot size/timing are proposals. No interviews, named partners, sensors, measured income increase or proven reduction in downgraded beans were invented.

## Research sources

- User-supplied Zamboanga del Norte industry challenge poster. Its 30–40% statement is attributed, not independently validated.
- ICCO: https://www.icco.org/harvesting-post-harvest-new/
- DOST-PCAARRD: https://ispweb.pcaarrd.dost.gov.ph/isp-commodities/cacao/
- TESDA: https://www.tesda.gov.ph/Downloadables/CS/CS-%20Cacao%20Bean%20Grading%20Level%20II.pdf
