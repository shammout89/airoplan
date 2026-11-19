# AeroPlan v0.2: department membership and authorization

- A fixed department workspace is initialized only by the verified Site owner's authenticated email. The stable Site user ID owns the workspace thereafter.
- Owner legacy records and audit entries migrate to that workspace upon the owner's authenticated visit. Other legacy user records remain untouched and isolated.
- Department membership and the platform's private Site visitor policy are separate controls. No Site audience changes or external invitations are performed by this release.
- Members are provisioned by an administrator using email. After first authenticated entry, the membership binds to the stable Site user ID. Email alone cannot replace an existing binding.
- Roles: administrator, planner, reviewer, approver, viewer. All route writes authorize server-side; only admins manage memberships and custom fields.
- The owner's membership cannot be disabled or demoted. Member disable and role changes take effect on subsequent requests.
- Task planning workflow: draft → submitted → reviewed → approved. Authors cannot review/approve their own work, and reviewers cannot approve the same work. Editing a task resets its approval. Approved planning records can be closed by an approver; this is not a maintenance release or airworthiness certification.
- Native ChatGPT sign-in is retained. Production has no test identities or login bypasses.

## Verification

`node tests/access.integration.mjs` bundles actual route handlers and runs them against disposable Miniflare D1 tables with test identity headers. It verifies 44 API requests covering authorization, legacy owner data migration, shared workspace reads, cross-workspace isolation, role changes, disable/re-enable, owner protection, email/ID binding, workflow transitions, and origin checks. Test data never enters the hosted database.

`npx tsc --noEmit` checks types. The Sites build checks deployability.

Interactive multi-user production sign-in remains a separate verification step; API tests do not certify platform sharing or browser sessions.

# v0.3: maintenance program definitions and controlled revisions

- Program library stores document code, revision, source document/revision, effective date, internal approval reference, applicability, and up to 100 task definitions per revision.
- Each definition holds task code, title, ATA/reference, explicit applicability (whole program fleet or selected aircraft), initial thresholds and repeat intervals for FH, FC, and calendar days/months. A zero initial limit is allowed; repeat intervals must be strictly positive and have a corresponding initial threshold. Omitted repeats denote a nonrepetitive definition.
- Planner/admin edits are limited to drafts. Submission, independent review and independent approval lock the revision. Approval requires an approval reference and an effective date that has arrived in Asia/Amman.
- Approved and superseded revisions are immutable. Creating a new revision copies definitions to a draft and clears the approval reference. Approving the new revision supersedes the previously active revision atomically, while retaining all history.
- Tasks may link only to an approved applicable definition. The server derives the title/reference and a source snapshot; forged source snapshots are discarded. Existing links to superseded revisions remain visible and retain their historical definition. They are not silently upgraded.
- Program revision updates use optimistic version checks. Record saves guard against concurrent record changes and program revision changes and log only successful writes in the same transaction.
- This release stores definitions; it does not calculate initial thresholds from entry into service, compute recurring due dates from accomplishments, or create next occurrences automatically. Operational task due limits remain manual. Internal approval is not regulatory approval or maintenance certification.
- Verification suite now covers 109 API requests, including all previous authorization scenarios plus program validation, revision workflow, stale write rejection, immutability, independent approval, supersession, source snapshot preservation, and applicability-safe linkage. Visual QA used a temporary local synthetic fixture that is removed before deployment. Hosted multi-user browser validation remains pending sign-in.

# v0.4: automatic due control and accomplishment history

- Aircraft may specify a service reference date, total hours and total cycles at that reference. All three are required to initialize automatic due control. This release supports initial thresholds relative to that explicitly entered service reference, and repeating intervals relative to the actual approved accomplishment; alternative scheduling bases are not implemented.
- Initialize from an applicable current approved program definition. It snapshots the reference and rules, replaces manual due limits, and returns the planning record to draft for independent planning review/approval.
- Calendar additions use UTC date arithmetic with month-end clamping (e.g. January 31 + one month → February 28/29). Day addition crosses leap days and year boundaries. Operational date comparisons use Asia/Amman. FH values are decimal hours; calculations round to six decimal places.
- Any configured limit reaching zero remaining makes a task due. There are no automatic tolerances, extensions, escalation policies or forecast utilization dates.
- Accomplishments capture actual date/FH/FC, document reference, performed-by text and notes. The document itself and personnel qualification checks are not yet supported. Values must be chronological and between the stored previous reference and current aircraft totals.
- Planner/admin records execution; independent review and independent approval are enforced. Planning must be approved before execution submission. Return-to-draft is available while under review. Approved accomplishments are immutable; formal post-approval correction/reversal is not implemented.
- Approval atomically freezes the accomplishment, closes that occurrence, generates exactly one successor when a repeat exists, and writes an audit entry. The successor uses actual execution counters/date (not approval date), keeps the same source program snapshot, and retains the task/occurrence lineage. Nonrepetitive definitions close without a successor. Concurrent/repeated approvals cannot create duplicate successors.
- Superseded program rules never silently upgrade. Approving execution under a superseded revision requires an explicit acknowledgement and continuation decision reference, saved with the approved record. The generated successor retains that historical source and is marked as linked to an older revision.
- Automatically managed task data and due limits cannot be overwritten through the general edit endpoint. Their closure must use accomplishment approval. Direct aircraft counter reductions and changes to service references already used in automatic schedules are blocked; controlled correction is a future feature.
- The execution register and per-task timeline expose the evidence and chain. Data exports include program revisions and accomplishments.
- Validation: 35 calculation/boundary checks plus 204 API integration requests covering the previous release and initialization, actual-date recurrence, chronological counters, planning preconditions, independent completion approval, simultaneous approval retries, one-time closure, old-source continuation, protected records and cross-origin/tenant checks. Visual QA uses temporary synthetic component fixtures removed before publication; production multi-user sign-in validation remains pending.

# v0.5: flight utilization, controlled corrections, acceptance evidence

## Flight ledger
- Each posted flight has an immutable source row, UTC departure at minute precision, unique aircraft/sector reference and unique aircraft/departure, flight number, route, actual duration in integer minutes and cycles.
- The first posting requires explicit confirmation of the existing total counters as a pre-flight opening balance, with an opening timestamp. Posting must be chronological, completed, and non-overlapping with the previous sector. A later edit to usage is an approved addition, not a destructive row edit.
- Posting atomically appends the flight, updates the aircraft counters and writes the audit entry. An optimistic aircraft revision prevents concurrent requests using the same counter state from both posting.
- Hours derive from opening hours + aggregate integer flight minutes / 60 + approved counter adjustments, rounded once to six decimals. Sixty one-minute flights do not accumulate per-flight rounding drift.
- Managed aircraft counters cannot be changed through the general aircraft editor; ledger metadata cannot be forged or cleared there.

## Controlled corrections
- Counter totals, flight usage amounts, and approved accomplishment fields may be corrected via draft → submitted → independently reviewed → independently approved. A reason and document reference are mandatory. Approved correction requests are immutable; later corrections append another request.
- All originals remain in their original tables. Effective-value pointers expose the most recently approved addition; each request captures before/proposed values and the calculated impact. GET execution and flight registers expose both original and effective values.
- Current counter corrections create ledger adjustments. Totals cannot fall below the service reference or any effective approved accomplishment. Flight usage corrections apply only a delta and must not cause overlap with the following sector. Flight identity/sector-reference/departure and service-reference edits are not supported by this correction path.
- Accomplishment corrections validate preceding and following effective accomplishment chronology/counters. An immediate open successor is recalculated in place from the corrected accomplishment, without generating another successor. A following execution under review must be returned to draft before correction; a draft must still satisfy the corrected baseline. Closed occurrences retain their historical due snapshots; the correction records the calculated historical impact rather than rewriting that history.
- Aircraft revisions serialize flight posting, execution mutations and correction application. Changing an affected context during a correction review invalidates the request; return-to-draft and resave are required before a new independent review. Corrections and their effects commit atomically with the audit record.

## Acceptance and verification
- The acceptance section starts with eight untested cases for actual login/roles, permission denial, company-record flight reconciliation, duplicate prevention, independent corrections, accomplishment impacts, concurrent requests, and qualified engineering reconciliation.
- User-entered evidence is append-only, tied to the release and the recorder. Synthetic evidence is labelled as such. It is never seeded into the production database as a real sign-off. The UI does not certify operational or regulatory readiness.
- Automated verification uses a disposable D1 database and five simulated role identities. 309 API integration checks cover prior functionality plus immutable flight originals, correction originals/effective views, open-successor recalculation, closed-history preservation, stale correction rebasing, duplicate/concurrent posting, meter protections, role separation, workspace isolation and acceptance evidence. There are also 35 recurrence/calendar boundary checks and 23 flight/ledger arithmetic checks.
- Browser component QA uses a temporary local synthetic fixture with planner/viewer controls and removes it before deployment. Native multi-account production login has not been verified; the browser reaches the private sign-in gate. No real aircraft documents, engineering reviewer, or operational case were supplied. Actual multi-account login and company-document/qualified-planner acceptance remain pending. They must not be reported as completed on the strength of simulated identities or synthetic fixtures.

# v0.6: forecast, work packs/resources, serialized components and life limits

## Forecast assumptions
- Per-aircraft manual FH/FC per day or observed usage averaged over a declared 7–365 calendar-day window. Observed values use effective corrected flight usage and include days without flights; no sample yields insufficient-data status.
- Each task shows the earliest projected limit, the governing FH/FC/calendar basis, the source assumption and partial-coverage warning. Fractional-day estimates are rounded to the start of that day. This forecast never changes a due limit or authorizes operation.
- A manual zero rate explicitly means no planned growth on that axis; no rate is not treated as a known zero. Very distant projections beyond the supported horizon are marked incomplete.

## Work packs and resources
- Resource pools declare manpower, tools, planning part quantities and bays, with capacity, optional UTC availability and a supporting reference. These are planning declarations, not live inventory or verified personnel licenses.
- Packs reference one aircraft's open, planning-approved tasks, UTC maintenance window, station, estimated man-hours, resource quantities and work reference. Labor demand cannot exceed reserved people × window hours.
- Overlapping active reservations are checked at each capacity-change boundary, so non-simultaneous reservations do not incorrectly add together. Started packs hold resources until completion/cancellation. A task cannot belong to two approved/started packs.
- Draft → independent review → independent approval with stale dependency detection and a workspace planning mutex to prevent concurrent overbooking. An overdue/predicted-before-window task requires a decision reference; that reference is not an extension or dispatch clearance.
- Start is restricted to the planned window and rechecks tasks/resources. Completion requires all referenced tasks to be closed through the existing execution workflow. Cancellation requires approver permission and a reason. Reserved resources cannot be edited until released.

## Component/life records
- PN/SN identities are unique and case-normalized. Registration captures name/ATA, LLP/rotable category, declared condition, total consumed FH/FC, fixed total-life limits or final calendar expiry, storage location and supporting life/certificate reference.
- Approved registration preserves an initial snapshot. Installation/removal/condition-release requests require independent review/approval; all approved movements retain before/after snapshots and the aircraft counter reference.
- Installed life = consumed life at last registration/removal + current aircraft totals − totals at installation. Removal freezes consumed life. Reinstallation on another aircraft continues from that life, without resetting TSN/CSN. Calendar expiry continues while stored.
- Installation is blocked for expired, quarantined or scrapped parts and occupied aircraft positions. A serviceability change for a stored part needs a documented condition movement; an expired/scrapped part cannot be released by that route.
- Counter changes below an installation anchor are rejected; counter corrections show component-life impact. Backdated flight posting/correction earlier than a current installation reference is blocked pending a controlled reference review. This initial module does not import historical movements, reset overhaul counters, verify a certificate's authenticity, or provide post-approval component-baseline corrections.

## Acceptance and verification
- Release 0.6 adds forecast reconciliation, capacity reservation, component-life and movement tests to the acceptance register (12 required manual cases). It retains earlier release evidence without treating it as current-release acceptance. No real sign-off is seeded.
- API suite: 466 requests against disposable D1 with simulated role headers, including all prior regression tests and manual/observed rates, booking races, resource capacity, lifecycle completion, immutable approved registration, duplicate PN/SN, occupied/expired installation rejection, stale movements after counter growth, remove/release/reinstall life preservation, tenant/origin checks and independent role approval.
- Pure calculation suites: 35 recurrence/calendar checks, 23 flight-ledger checks and 36 forecast/lifetime/resource-sweep checks (94 total). Type checks and deploy build also run.
- Temporary synthetic browser fixture covers forecast, work-pack form/resource controls and component record/movement display; removed before publication. Actual multi-account production sign-in, real company-document reconciliation and qualified engineering acceptance remain unverified because the actual accounts, case records and reviewer were not supplied. This is still a prototype, not a certification of operational/regulatory readiness.
- Component wear in this release assumes a 1:1 increase with the installed aircraft's FH/FC. Independently metered equipment, differing usage factors and overhaul/reset life bases need separate models and are not represented by these calculations.
