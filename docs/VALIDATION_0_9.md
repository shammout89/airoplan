# Validation record — AeroPlan 0.9

This release includes the document/configuration/inventory/import work described in VALIDATION_0_8.md and technical requirement follow-up described in TECHNICAL_REQUIREMENTS_AR.md.

The actual route-handler integration suite passed 724 requests in disposable D1/R2 resources with simulated identities and synthetic source documents. It includes 106 technical follow-up scenarios: source versions, aircraft/component scope, independent approvals, applicability decisions, internal and external evidence, a later correction approved through the operations API, rejection of stale evidence review, explicit replacement with preserved history, identity changes, re-evaluation, revision gaps, non-applicability and reporting. Existing regression scenarios remained green.

Calculation and boundary suites passed: 35 recurrence, 23 usage/ledger, 36 planning/capacity and 20 formula/condition/CSV checks (114 total).

An independent restore drill matched all digests for 18 tables, 409 synthetic rows and two document files in separate disposable D1 and R2 resources. The live-restore code was exercised only on disposable databases. Access disablement, audit and acceptance evidence made after the snapshot remained intact. A prior v6 production snapshot with two metadata rows also remained independently verifiable.

Browser QA used labelled, temporary, client-only fixture pages. It verified the document/inventory/configuration/alert screens, reading an actual two-row XLSX fixture in the browser, and the technical matrix and applicability controls. Changing the decision to non-applicable removed task selection. Fixture API responses were not production sessions. All fixture routes were removed before packaging.

No production maintenance requirement, applicability decision or execution was seeded, and no operational acceptance result was automatically passed. The production workspace was previously observed to contain only its workspace and owner metadata. Real role sign-in, company data and engineering acceptance remain pending. Direct integration to an external operations or inventory product remains unconfigured; this release provides internal links and authenticated file exchange. No periodic backup schedule, email alert delivery or regulatory feed was enabled.
