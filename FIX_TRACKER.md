# Duck Playspace Fix Tracker

Use this file to track the code-review fixes and resume work across sessions. Update the status and notes here after each fix.

Last updated: 2026-10-07

## Completed

- [x] **Participant uploads preserve existing data.** Uploads no longer drop `imported_data`; they add new participants, update an existing participant by email, skip unchanged rows, and run as one transaction. The upload page explains the add/update behavior.
- [x] **Failed-event tracking in Dashboard > Events.** Records event name, date, event type (including Mono/Poly and custom values), and participant RSVP yes/no lists. Failed events do not count physical attendance or revenue; payment and date-stat routes reject inappropriate entries.
- [x] **Current-page navbar indicator.** A shared script marks the matching navigation link active and sets `aria-current`.
- [x] **Events page participant lists.** Removed the fixed height that clipped long lists, placed Men/Women/Other in columns (stacked on smaller screens), and added age-ordered numbers with more visible names.
- [x] **Participation edits save consistently.** Edits use a transaction, refresh participant totals, and recalculate the last attended event. Fixed an undefined variable that caused edits to report failure after saving.
- [x] **Date attendance is no longer inferred from event attendance.** Event imports use an explicit “Went On Date” field when present. Otherwise Date Stats attendance stays unknown; existing known values are preserved on re-import.
- [x] **Participant search, status filtering, and profiles.** Search and case-insensitive status filters now affect the participant list; saved statuses and the Active count handle status casing; participant profile clicks no longer reference an undefined variable.
- [x] **Date Stats totals follow the selected event.** Summary cards use the same filtered records as the table.
- [x] **Relationship Style DATA filter.** Added to the filterable participant fields.
- [x] **Fresh-database participant table setup.** `imported_data` is created during database initialization, not only after an upload.
- [x] **Import and rollup consistency.** Event/date import paths resolve email addresses case-insensitively to the participant’s stored email; participant uploads preserve the stored email spelling when updating a match. Imports refresh participant attendance/payment rollups. Syncing a date reuses an event found by case-insensitive name instead of creating a capitalization duplicate. Failed events are excluded from revenue and attendance rollups. Reward tags are recalculated on rollup refresh and cleared when a participant no longer meets a threshold.
- [x] **Event dashboard View action.** Selecting View on an event now opens Participation, filters to that event, and scrolls to its participant rows; removed the unused sync alert stub that had no connected action.
- [x] **Event upload date parsing.** Preserved calendar dates from CSV and Excel cells instead of allowing local timezone conversion to shift them by a day. ISO, slash-formatted, month-name, and Excel date-cell inputs now retain the intended date.
- [x] **Poll navigation script placement.** Moved the shared navigation marker out of the generated AMP email template and into the actual Poll page; the previous placement broke inline script parsing.
- [x] **Dependency audit findings.** Updated Multer, `proxy-addr`, and `qs`; replaced the stale npm-registry `xlsx` package with the official SheetJS 0.20.3 tarball. The user ran `npm audit` and confirmed zero vulnerabilities. Local parser smoke checks passed with the replacement package.

## Remaining

- [ ] **Complete database-backed end-to-end verification.** Server/database route flows remain unverified. Syntax checks, `git diff --check`, CSV and Excel event parsing, and parsing the supplied PDF (Riverside Golden Hour, 9 participants) passed. The local PostgreSQL server is not running; the configured `.env` database was not connected to avoid touching nonlocal data.
- [ ] **Review the combined local changes before deployment.** The source tree already had unrelated uncommitted feature work when this tracker was added. Review the full diff and decide what to commit/deploy.

## Explicitly out of scope

The user asked to leave these review findings unchanged:

- Hardcoded admin password/session secret and static-page authentication behavior.
- Quiz route access, answer-key exposure, and question-to-quiz validation.
- Poll endpoint exposure of the full poll record.

## Working notes

- Changes are in the local source clone at `/tmp/duck-playspace-codex`; they have not been deployed or applied to the live database.
- When resuming, start with the **Remaining** checklist, then update this tracker immediately after each additional fix.
