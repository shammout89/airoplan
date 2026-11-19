# Validation record — AeroPlan 0.8

Automated verification uses disposable D1/R2 resources, simulated identities, and synthetic maintenance data. It does not establish operational acceptance.

- TypeScript: `npx tsc --noEmit` passed.
- Actual API handler integration: 618 requests passed. Covers previous regressions and document publication, private downloads, immutable published metadata and links, inventory reservation/issue, policy pinning, safe field changes, preview/commit import, alert audiences and effective flight reporting.
- Calculation and boundary suites: 35 recurrence + 23 usage/ledger + 36 planning/capacity + 20 formula/condition/CSV checks passed.
- Independent restore drill: 18 tables, 343 synthetic rows and two document files restored into separate disposable D1 and R2 resources; table and file digests matched. Live restore was exercised only on disposable test resources. Post-snapshot membership disablement, audit and acceptance evidence survived.
- Browser QA used a temporary client-only fixture route, labelled synthetic. Documents, inventory, settings, approvals, alerts and import screens rendered in Arabic. A real XLSX test fixture with two aircraft rows was read and mapped by the browser parser, then displayed by the import preview. Browser API responses were fixtures; server import validation/commit was tested independently with the real handlers. The fixture route was removed before packaging.
- Legacy v6 snapshots remain downloadable and independently verifiable. Live restore requires the current schema; a legacy snapshot cannot erase new tables implicitly.

Pending: actual user sign-in with each intended role, company data and engineering review, agreed backup schedule/retention/RPO/RTO, external system specifications and credentials for a direct integration, and a production-volume performance/security assessment. No operational acceptance case was marked passed automatically.
