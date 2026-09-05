# Build Evidence

## Verified locally on 2026-09-04

| Claim | Evidence | Result |
| --- | --- | --- |
| No legacy runtime coupling | `npm run check:legacy-free` | Passed: no runtime legacy-platform references found. |
| Core service behaviour | `npm test` | Passed: 7 tests covering custody, signatures, idempotent fulfilment, approved prices, unavailable checkout, public API, authenticated operator workflow, user provisioning and Studio guard. |
| Static build | `npm run build` | Passed: public assets emitted to `dist/`. |
| Reader-facing Library | Real browser at `http://127.0.0.1:4173/` | Rendered current Library, title card, A$14.95 digital CTA, A$19.95 monthly CTA, Studio and Operations paths. |
| Non-live checkout posture | Real browser click on Membership CTA | Rendered explicit `Checkout not available` message; no entitlement was granted. |
| Protected Studio | Anonymous real-browser request to `/studio.html` | Server redirected to `/login.html?next=%2Fstudio.html`. |
| Authenticated Studio intake | Real browser session using temporary local bootstrap operator | Rendered Studio and successfully staged a verification manuscript with status `staged` and displayed SHA-256 prefix. Browser console: 0 errors, 0 warnings after the final interaction. |

## Not verified and therefore not claimed

- PostgreSQL migration execution on Pax Node 1.
- TLS/reverse-proxy deployment, backups, malware scanning or production storage controls.
- Live Stripe account, `price_...` objects, webhook endpoint, real payment, refund, subscription lifecycle or reconciliation.
- Verified KDP/Amazon hardcover listing, territory, price or storefront handoff.
- Full record/asset migration and screen-by-screen parity against the reference application.
- Independent Claude adversarial audit and sign-off.

The local JSON store and browser-staged manuscript used for verification are development-only artefacts. They are ignored by Git and must not be treated as canonical CW material.
