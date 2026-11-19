# AeroPlan 0.11.0 — verification record

Verified on 14 November 2026 using Node 24.22.1 on the managed Linux test host. All data and accounts used for automated tests and browser QA were synthetic and disposable. No company's operational acceptance or live integration has been certified by these tests.

| Area | Observed result |
|---|---|
| Existing shared API regressions | 792 checks passed on local SQLite and separately on disposable D1 |
| New controlled workflows and services | 316 advanced API checks passed on SQLite and 316 on disposable D1 |
| Native production HTTP gateway | 122 checks passed, including SSR/assets, roles, authentication, CSRF/Host rejection, owner-only metrics/services, loopback service denial, HTTPS-origin Secure session behavior and build provenance |
| Domain calculations | 191 checks across aircraft, recurrence, flight arithmetic, forecasts/resources, flexible fields, DST/flight-day deadlines, independent APU/TBO, reliability and compliance |
| Complete encrypted backup | 34 checks: consistent online SQLite snapshot, attachments and accounts, wrong key/tamper rejection, isolated restore, session revocation, retention, schedule/retry and unavailable external marker |
| Native connections and mail | 34 checks: real localhost HTTP pagination and mapping, failed/repeated pages, secret redaction, cursor reset, real SMTP over TLS using a test CA, Message-ID, schedules and recovery pause |
| Storage and identity | Native SQLite transactions, migration digest guards, object digests, enrollment, sessions, rate limits, restart and independent file restore passed |
| Builds | TypeScript noEmit, Node production build and Cloudflare-compatible build passed |
| Upgrade | Original 0.9 SQL migrations 9 → 10, existing legacy aircraft bytes and owner preserved, existing password successfully authenticated |
| Overlay rehearsal | Applied cumulative source changes over the original 0.9 archive; source bytes matched, Compose/environment/data/secrets/generated backup overlay were preserved; Node build and production HTTP suite passed |

The API suites contain both route invocations and assertions; the counters are test checks, not claims of that many unique user scenarios.

## Browser QA

An isolated native production gateway was reviewed in Chrome with a synthetic owner and seeded test aircraft, tasks, documents and APU. Verified:

- APU reading draft saved with a published evidence version; 832 TSN remained unchanged until approval. A self-review attempt was refused.
- Defect report saved and appeared on the linked aircraft.
- Unconfigured operations/inventory/SMTP were displayed explicitly and external actions disabled; owner metrics were visible.
- Evaluating alerts created pending messages without sending mail. Documenting follow-up changed the incident to acknowledged and its queued message to cancelled.
- A complete encrypted backup was created and verified, then restored into an isolated temporary directory from the UI.
- Acceptance displayed 47 untested company cases, zero approved, and disabled release sign-off.
- Maintenance plan showed 50 rows on page one and 12 rows on page two for 62 tasks; global counts stayed complete.
- Reliability showed 3 recorded FH/3 cycles and 4 synthetic defects after the UI-created report, with a null compliance percentage and visible incomplete-exposure note.

Native browser datetime segmented controls did not accept automated fill reliably; entry forms now provide a current UTC default. API boundary tests independently verified arbitrary UTC instants, calendar deadlines and DST boundaries. The standard native date picker remains editable.

## Reproducible load test

Fixture: 120 aircraft, 10,000 tasks and 5,000 flights. Actual production gateway, 5 concurrent requests, 40 measured requests after initial validation:

| Measurement | Result |
|---|---:|
| Failed requests | 0 |
| Median | 135 ms |
| 95th percentile | 323 ms |
| Throughput | 29.9 requests/second |
| Largest response | 159,981 bytes |
| Process RSS at measurement | 252,608,512 bytes (about 241 MiB) |

An initial load run exposed repeated Intl formatter construction. Reusing formatters and caching aircraft readiness per request reduced the measured p95 from about 4.5 seconds to 323 ms and RSS from about 2 GiB to 241 MiB on the same fixture. Measurements describe this test host and workload, not a guaranteed Windows or production capacity. Re-run `npm run benchmark:docker` on the intended host after `npm run build:docker` and dependency installation.

## Verification limits

- Docker engine and PowerShell were unavailable on the test host. The actual Node runtime that the image starts was built and tested; no claim is made that a Docker image, Windows script or Caddy certificate issuance was executed here. The provided scripts and Caddy/Compose templates need the documented target-host acceptance checks.
- The company's actual API contracts, inventory reconciliation, SMTP account, recipient delivery, DNS, NAS mount and recovery timing were not supplied. They remain unconfigured/unaccepted until the operator configures and verifies them.
- One application instance with SQLite is supported. This release does not provide a multi-writer cluster or vendor-specific OAuth/ERP write adapter.
- Complete backup and business JSON backup have different scopes and capacities; see the operational runbook.
- Software checks do not replace engineering approval, company MEL/CDL procedures or authority approval. Company acceptance evidence remains empty in the delivered application.
