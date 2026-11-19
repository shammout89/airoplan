# AeroPlan 0.11.0 — REST connector contract

## Boundary

Native Docker/Node only. Generic pull adapters for actual flown sectors and authoritative on-hand inventory balances; no claim of compatibility with an unnamed vendor API. An API administrator maps the vendor fields in the external `connections.json` secret. The browser configures schedules and reviews journal rows, never credentials. Existing Excel/file exchange remains available. This release does not submit flight-release decisions, purchase orders or reservations into an external ERP; ERP stock movements are executed there and reflected by the next balance snapshot.

Transport: GET, HTTPS, JSON, optional Bearer credential, no redirects across hosts, 20-second request limit, at most 4 MiB/page, 20 pages and 1,000 rows per run. Numbers must be JSON numbers in the provider's response; the connector does not infer airborne time from block time or silently convert units. Use a provider-side adapter if conversions or OAuth token refresh are required. OAuth client-credential acquisition and vendor-specific signatures are not part of this generic Bearer contract.

`itemsPath`, `fields.*`, `nextCursorPath`, and `watermarkPath` are dot paths. No expressions or JavaScript execute; prototype paths are rejected. `cursorParam` traverses pages within one run. `sinceParam` sends the last committed ingestion watermark; `watermarkPath` reads the provider's durable watermark from the final page. Without a watermark each poll starts from the beginning, relying on stable ID/hash deduplication. Size the provider query window to fit the batch cap. A partial/invalid HTTP response never advances the ingestion watermark. Watermarks mean reception into the durable journal, not approval/posting of every row. Failed rows remain available for explicit retry and are included by scheduled commits.

## Operations rows

| Mapped field | Required semantics |
|---|---|
| externalId | Stable source sector ID; maximum 200 characters |
| aircraftKey or registration | `aircraftMap` maps the external key to one existing registration |
| reference | Unique technical-log sector reference; otherwise sourcePrefix + externalId |
| flightNumber | Actual flight identifier |
| from, to | IATA/ICAO, 3–4 alphanumeric characters |
| departure | Actual UTC departure, ISO `YYYY-MM-DDTHH:mm:00.000Z` |
| durationMinutes | Actual airborne minutes, integer 1–2880 |
| cycles | Actual cycles, integer 1–100 |
| notes | Optional text |

New ledgers require the operator to reconcile opening counters. Set `confirmOpening:true` only after this check and set `openingAsOf` to the aircraft's verified counter snapshot instant. Existing ledgers do not reapply an opening. Aircraft must have a verified card. Existing chronological, overlap, duplicate-reference, component-installation and defect restrictions are enforced by the shared flight-posting function. The connector cannot automatically acknowledge a grounding/MEL exception; the operator investigates and, if recording actual flown usage is necessary, uses the explicit manual exception workflow.

Identity: `(source,type,externalId,payloadSHA256)`. Exact repeats are ignored. A different payload for a previously posted source identity becomes a conflict, never a silent counter replacement. Use the independent correction workflow and reconcile the provider. If the process stops between posting and journal acknowledgement, only a matching immutable integration proof on the flight permits reconciliation as already posted.

## Inventory rows

| Mapped field | Required semantics |
|---|---|
| externalId | Stable balance snapshot ID; new snapshots need a new ID |
| stockKey or stockCode | `stockMap` maps the external key to an existing active local stock code |
| onHand | Nonnegative JSON number, up to 6 decimal places, max 100,000,000 |
| asOf | Valid UTC ISO timestamp, not in the future, strictly newer than the previous accepted source snapshot |
| inventoryMode | Connection-level `on_hand_authoritative` is required |

Preview freezes the local stock etag. Changed stock requires explicit refreshed preview; reserved quantity is retained. Reject source balance below local reservations, older snapshots, and a second authoritative source for the same material. Once external master is active, local stock receipt/issue approval is blocked to prevent duplicate movements. Reservations can remain local; reconcile fulfilment and cancel/release local reservations through the documented stock-request process when ERP work is completed. The adapter never guesses fulfilment of a local task or material request from a balance decrease.

For a corrected aircraft/material mapping, use the owner action to reset the reception cursor with a reason and preview again; applied facts remain protected. Unposted rows can refresh their preview after missing local aircraft/stock is created. Conflicted/applied originals cannot be refreshed into mutable records.

Every journal record stores source ID, received payload, hash, received time, error/preview and applied result/reference. API credentials are held outside the business database. Journal pages contain 100 rows; corrected source data is retained as a new received version, with applied originals intact. Source polling uses exponential delay after failures, up to four hours; no polling failure is reported as a connected/successful run.

## Recovery and access

Service route is restricted by the native gateway to loopback POST and an in-memory random bearer credential. It is also verified by the shared route. External sessions and forged user/proxy headers cannot activate it. System actions have explicit system audit actors and are subject to the recovery write gate; they do not impersonate a human approver.

A changed recovery epoch pauses connectors and SMTP. Reconcile upstream sectors, stock and deliveries before documented owner resume. Keep source IDs stable across restore and do not assume an old snapshot contains events posted after its capture time.

## Acceptance fixture

Use the actual company's read-only test endpoint first. Verify field units, UTC, stable identifiers, duplicate pages, changed facts, API failure, pagination, unknown mappings, late sectors, and reserved-stock conflicts before enabling autoCommit. Automatic tests use an isolated localhost HTTP fixture and a local TLS SMTP server; they do not prove the company's contracts are configured or accepted.
