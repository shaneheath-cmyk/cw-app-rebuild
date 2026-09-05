# Collective Writings

Standalone rebuild of the Collective Writings Library. This repository is the new runtime; the former Base44 application is reference-only for migration and visual-parity review.

## Local run

Requires Node 20 or later. No package installation is required for the first foundation slice.

```powershell
npm run dev
```

Open `http://localhost:4173`. Development records live under `data/` and artefacts under `storage/`; both are deliberately ignored by Git.

## Commercial policy

- Membership: A$19.95 per month via Stripe live Checkout.
- Digital title: A$14.95 one-time purchase via Stripe live Checkout.
- Hardcover: external KDP/Amazon storefront link, expected A$34.95 after listing verification. It is not a CW Checkout sale.

Stripe live secrets are server-only environment variables. A Stripe webhook, not the success-page redirect, creates an order or entitlement.

## Gates

```powershell
npm run check:legacy-free
npm test
npm run build
```

See `docs/REBUILD-BLUEPRINT.md` for the governing migration and delivery plan, and `audit/CLAUDE-AUDIT-BRIEF.md` for the independent audit scope.

## Pax Node 1 runtime

When `DATABASE_URL` is configured, the service uses PostgreSQL and requires the recorded migration state. The loopback-only systemd definition is at `deploy/cw-app.service`; its activation evidence is in `docs/POSTGRES-RUNTIME-EVIDENCE.md`. It is deliberately not public until a TLS/reverse-proxy release is separately approved.
