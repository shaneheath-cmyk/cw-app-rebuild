# Rebuild Blueprint

The complete approved rebuild blueprint is retained in the Codex delivery workspace and will be versioned here before the first migration commit. The implementation foundation follows these fixed decisions:

- Preserve the current visual schema; refine only accessibility, responsiveness, state handling and consistency.
- Replace Base44 runtime, SDK, auth, entities, storage, workflows, agents and hosting with CW-owned services on Pax Node 1.
- Use zones `staging`, `source-vault`, `editorial`, `production`, `release` and `archive`, with checksum-linked provenance.
- A literary assistant may retrieve, classify, parse, propose metadata and create editorial packets. Human custodians approve canon, release and financial actions.
- Digital commerce is Stripe Checkout: A$19.95 monthly membership and A$14.95 one-time digital title. Hardcover is a KDP external storefront link, currently expected at A$34.95.
- The production target is PostgreSQL plus managed local file storage. The initial development store is a local JSON adapter only and is not a production database.
