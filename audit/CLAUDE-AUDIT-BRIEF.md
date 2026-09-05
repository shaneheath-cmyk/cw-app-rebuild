# Claude Audit Brief

Audit this repository as an adversarial independent reviewer. Do not redesign the interface or broaden the product scope. Report findings by severity with file and line references, then test gaps and residual risks.

Focus on:

- Base44 removal: no SDK, runtime imports, hosted asset URLs, auth, deployment or service calls remain.
- Stripe: live/test mode separation, server-side price allow-list, raw-body signature validation, event deduplication, idempotent fulfilment, refunds/subscription state, and absence of secrets in the client.
- Custody: path traversal, unsafe filenames, source immutability, checksum/provenance, state-transition authorisation, and agent approval boundaries.
- Public/API: authentication assumptions, authorisation, CORS, data exposure, error handling, rate/size limits, and unsafe file delivery.
- Operations: data-store limitations, backup/restore posture, configuration validation, and deployment readiness.

This initial slice is deliberately development-storage backed. Treat PostgreSQL migration, live Stripe credentials/webhook registration, malware scanning, TLS deployment, backups, KDP listing verification and real transaction evidence as blockers to production or revenue-live sign-off.
