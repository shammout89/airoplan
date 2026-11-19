# AeroPlan 0.12.0 — verification record

Verified 14 November 2026 using Node 24.22.1 on Linux. All aircraft, documents, authorizations and identities used in automated or browser verification are synthetic. No company maintenance records were altered and no operational sign-off was created for the user.

| Check | Result |
| --- | --- |
| TypeScript `tsc --noEmit` | Passed |
| Native production build `npm run build:docker` | Passed |
| Framework build through `build-site.mjs` | Passed |
| Existing API regression suite | 792 checks passed on SQLite and D1 |
| Advanced API suite | 325 checks passed on SQLite and D1 |
| New scheduling API suite, including additional history/restore scenarios | 152 checks passed on SQLite and D1 |
| New pure scheduling engine | 62 checks passed |
| Existing pure domain checks | 191 checks passed across aircraft, recurrence, operations, planning, flexibility and advanced domains |
| Native production HTTP | 125 checks passed, including authentication/Origin denial for the new variation endpoint |
| Encrypted full backup | 34 checks passed |
| Native integration/SMTP services | 34 checks passed |
| Native storage/auth regression | Passed |
| Source whitespace/integrity | `git diff --check` passed; native build fingerprint matched current source |

`npm run test:docker` runs the full existing suite plus scheduling tests using disposable SQLite. The scheduling test was extended after that full pass with chain pagination and actual staged/live business restore, then rerun successfully on both SQLite and D1. These are assertions, not a count of independent operational acceptance cases.

## Scheduling-specific evidence

- Independent FH, FC and calendar calculation bases; fixed nominal anchors; leap years and January/February/March month ends; different first/repeat units; fractional FH; one-off tasks; no skipped overdue recurrence; unsupported engine/sequence rejection and preserved legacy behavior.
- Published programme-policy evidence with byte verification and immutable snapshots; rejected missing/foreign/corrupted evidence; role restrictions and a pinned approval policy; distinct preparation, review and approval.
- Positive bounded occurrence-specific grants; denied stacking, unauthorized axes, retroactive grant or grant after actual execution is recorded; cancellation retains its audit history.
- Two concurrently approved requests for one occurrence yield one success and one conflict. Aircraft revisions serialize authorization with actual usage, execution and correction changes. Maintenance recovery mode blocks the new endpoint.
- Approved limits do not overwrite original limits. Execution within variation is classified separately; a cancelled or exceeded authorization cannot silently make a late execution compliant. A departmental approval date protects midnight/time-zone boundaries.
- Actual execution outside authorized limits requires a reference explaining the real exceedance for tasks with an explicit policy. The next nominal occurrence is frozen with its calculation and source snapshot; granted increases are not carried forward.
- Correcting accomplishment changes dependent actual-based axes while retaining previous-due and fixed-calendar axes. Historical nominal limits remain unchanged. A correction that would change an open child's authorized nominal limits is rejected until cancellation of that authorization.
- A technical AD link to the root of a recurrence chain blocks a general variation on its child. Adding an AD relationship while a general authorization is active is also prevented by validation.
- Chain retrieval is scoped, ordered and paginated at 50 records; a 52-occurrence fixture returns distinct pages and a missing/foreign task is rejected.
- A complete business snapshot with policies, approved/cancelled requests, accomplishment corrections and an active historical authorization was captured, staged, restored through the actual live restore function, and checked by table digests on both engines. Source document bytes and calculation data were retained; maintenance mode and changed recovery epoch remained enforced. A resealed snapshot with a changed nominal due limit was rejected semantically.

## Browser verification

The current native production build was run in an isolated QA directory, using the managed preview and disposable local authentication. Verified programme revision creation, policy-field editing and persistence, selected calculation bases, published evidence selection, an actual variation-draft save, original/requested limits, and the execution preview. A final RTL check confirmed isolated left-to-right numeric limits inside the Arabic screen. The previous homepage warning requested for removal remains absent.

Screenshot: [scheduling-0.12-qa.jpg](proof/scheduling-0.12-qa.jpg). The screenshot shows a draft, which deliberately does not grant a tolerance.

## Limits of verification

Docker Engine and Windows PowerShell are not installed in this environment. The production Node gateway, both database adapters and native build were tested; execution inside the user's Windows Docker Desktop remains to be checked there. The user's last reported Docker API 500 is not proven resolved by these tests.

No claim is made that EASA, CARC or another authority has approved the software or the configured intervals. Company programme references, classifications, absolute variation ceilings and approval authority must be supplied and independently checked. The three new company acceptance cases remain subject to the existing evidence-based acceptance workflow. Existing initialized chains retain their original policy and are not silently migrated to a newer programme revision.

Release and update instructions: [RELEASE_0_12_AR.md](RELEASE_0_12_AR.md). Functional detail: [SCHEDULING_0_12_AR.md](SCHEDULING_0_12_AR.md).
