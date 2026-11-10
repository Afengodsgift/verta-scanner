# Verta Readiness Scanner

Paste a store URL, get a readiness score across 8 layers (discoverability, semantic clarity, product infrastructure, inventory, pricing, policies, interaction, transaction readiness), with evidence and a fix for every finding.

- `lib/analyze.js` pure scoring (no network). `lib/scan.js` crawler. `lib/net.js` SSRF-safe fetch. `api/scan.js` Vercel function. `public/index.html` UI.
- `npm test` runs offline fixture tests. `npm run dev` serves on :3000 (set `ALLOW_PRIVATE=1` only to scan local fixtures).
- The score and weights are a working hypothesis, not a standard. Cannot see checkout or anything behind a login.
