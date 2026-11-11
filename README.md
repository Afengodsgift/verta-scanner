# Verta Readiness Scanner

Paste a store URL, get a readiness score across 8 layers (discoverability, semantic clarity, product infrastructure, inventory, pricing, policies, interaction, transaction readiness), with evidence and a fix for every finding.

- `lib/analyze.js` pure scoring (no network). `lib/scan.js` crawler. `lib/net.js` SSRF-safe fetch. `api/scan.js` Vercel function. `public/index.html` UI.
- `npm test` runs offline fixture tests. `npm run dev` serves on :3000 (set `ALLOW_PRIVATE=1` only to scan local fixtures).
- The score and weights are a working hypothesis, not a standard. Cannot see checkout or anything behind a login.

## Access model (v2.1)
- `/` public merchant landing page, `/about` method, `/report#r=...` client-facing read-only report (no API calls).
- `/app/` and `/app/prospects` are the team tool (noindex). `POST /api/scan` requires header `x-verta-key` equal to env `VERTA_ACCESS_KEY` (fails closed if unset; failed attempts rate-limited).
- Set contact details for the landing page in `public/config.js` (contactEmail / bookingUrl / senderName).
- Dev: `npm run dev` uses key `dev-key`.
