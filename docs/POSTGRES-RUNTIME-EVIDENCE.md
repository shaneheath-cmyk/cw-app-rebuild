# PostgreSQL Runtime Evidence

Verified on Pax Node 1 on 2026-09-05.

| Claim | Readback | Result |
| --- | --- | --- |
| PostgreSQL service | `systemctl is-active postgresql` | `active` |
| Runtime service | `systemctl is-active cw-app.service` | `active` |
| Migration ledger | `cw_schema_migration` | `001_initial.sql`, `002_runtime_state.sql` |
| Runtime store selection | `GET /api/health` on node loopback | `{"status":"ok","store":"postgresql","stripeMode":"unconfigured"}` |
| Application read | `GET /api/library` on node loopback | `{"works":[]}`; no synthetic catalogue was seeded into PostgreSQL |
| Application write | `cw_runtime_state` | Bootstrap created one user and one audit event through the running application (`1:1`) |
| Network boundary | `ss -ltnp` | Node listening only at `127.0.0.1:4173` |
| Secret custody | `/etc/cw-app/cw-app.env` | Root-owned mode `600`; no database value committed or printed |

This proves a loopback-only application process reading and writing `cw_library` through `DATABASE_URL`. It does not prove public deployment, TLS, backup/restore, malware scanning, data migration, Stripe live commerce, or revenue fulfilment.
