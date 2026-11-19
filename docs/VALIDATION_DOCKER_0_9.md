# AeroPlan 0.9 — Docker self-hosting validation

Validation date: 2026-11-14. Synthetic data only. Existing hosted deployment remains separate from this self-hosting target.

## Implemented

- A separate Node production build of the existing React/Vinext application. The shared business route handlers and SQL migrations remain in use.
- A D1-compatible local SQLite adapter, atomic SQL batches, WAL/FULL durability, migration checksums and explicit owner/workspace bootstrap.
- A private filesystem object store with random physical filenames, flushed files/directories, SHA-256 verification and independent backup copies. Replaced/unreferenced blobs are retained rather than removed while a reader might still use them.
- Local password authentication, bounded scrypt concurrency, hashed session/enrollment tokens, expiring sessions, login rate limits, single-use enrollment and password/session revocation.
- An authenticated HTTP gateway: inbound identity/proxy headers are discarded, identities are set only from verified sessions, Host and write Origin are checked, and the framework's temporary loopback listener is closed before the public gateway opens.
- Non-root Docker runtime, read-only root filesystem, persistent named data volume, health check, localhost port default, bounded logs and graceful shutdown.
- Arabic setup, account administration, update and complete-volume backup/restore instructions. A restore override selects a new volume and retains the original.

## Passed in this environment

| Check | Evidence |
| --- | --- |
| Node production build | `npm run build:docker` succeeds |
| Local adapter/auth tests | Atomic rollback/CAS, migration replay/checksum, object integrity and independent copies, owner protection, enrollment replay rejection, disable/reset/password revocation, rate limits and reopened-database persistence |
| Business API regression on local adapters | 724 checks; includes 123 extension and 106 technical requirement scenarios, document-inclusive backup verification and live-restore regressions |
| Existing Cloudflare adapter regression | The same 724 API checks pass on disposable Miniflare D1/R2 |
| Production HTTP | 60 checks on the built Node server: login, forged identity/CSRF/Host rejection, SSR and static asset serving, four roles, independent task approval, upload/download integrity, backup/drill, disabled users, session revocation, process restarts, HTTPS public-origin handling and Secure cookies |
| Pure calculations | 114 checks: 35 recurrence, 23 usage, 36 planning, 20 flexibility/CSV |
| Owner console | Interactive TTY initialization and password recovery pass; passwords are not echoed |
| TypeScript | `tsc --noEmit --incremental false` passes |
| Configuration | Compose files and workflow parse as YAML; new self-host source passes ESLint |
| Hosted build | Existing production build succeeds without using the local SQLite bindings |

## Explicit limits

No Docker/Podman executable or daemon was available in this workspace. The Docker image build, Compose startup, actual named-volume lifecycle and container restart test have **not** been executed here. A reusable `AEROPLAN_HTTP_DOCKER=1` mode runs the HTTP suite against the built image with a disposable Docker volume, and the supplied GitHub Actions workflow builds and checks the image when run on a Docker-enabled runner. These supplied checks are not evidence that CI has already run.

The full-volume archive commands are documented procedures and were not exercised on Docker here. Existing hosted data is not automatically migrated. Hosted backup service credentials are not copied to this deployment, and no new periodic backup schedule is enabled. This is a single-instance SQLite deployment. Real airline operational acceptance, deployment on the user's machine and operator restore drills remain separate tasks.
