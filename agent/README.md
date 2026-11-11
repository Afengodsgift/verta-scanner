# VERTA Agent MVP

Mission-driven audit agent (the paid-audit instrument; the root scanner is the free Mini Audit).

```
Mission → Brain → Action Validator → Playwright controller → Observer → Evidence store
        → Evaluator → Failure classifier → Scoring (v0.1) → Report (JSON / MD / HTML)
```

## Run
```
pip install playwright --break-system-packages && playwright install chromium
python3 -m verta_agent https://store.example --query "stainless ball valve" --attribute "pressure rating" --out run1
python3 -m verta_agent URL --query "..." --llm      # Claude brain (needs ANTHROPIC_API_KEY; falls back to heuristic per step on error)
python3 -m unittest tests.test_agent                # offline, local fixture stores
```
Output: `report.json` (canonical), `report.md`, `report.html`, `evidence.json`, `trace.json`, `screenshots/`.

## Authorized mode: login + test-card checkout
Off by default. For merchants who have agreed to it (paid audit, written permission):
```
export VERTA_LOGIN_USER=... VERTA_LOGIN_PASSWORD=...        # test account the merchant gave you
python3 -m verta_agent https://shop.example --query "..." --login \
  --payment-test --authorization-ref AUTH-2026-001 --authorized-hosts shop.example --test-profile profile.json
```
Gates (all required, or the run refuses): authorization reference, host on the allow-list, card is a known processor TEST number (4242…, 4000 0000 0000 0002 etc.). A decline counts as success (the checkout pipeline works end to end); an accepted test card is flagged so the order can be cleaned up. Credentials and card data are never written to evidence or trace. Never run this on a store that has not agreed.

## Safety (default)
Validator allows only goto/click/fill/press/extract/wait/finish; same-host only; any click on pay/place-order controls or any fill of payment/credential fields ends the mission with `SAFETY_STOP`. In default mode the agent stops at the checkout page and never touches payment or password fields.

## Honest status
- Heuristic brain is tested on fixtures only; LLM brain is untested without an API key.
- Not assessed yet (excluded from overall, stated in report): Search & Navigation, Quoting/RFQ, Authorization/Security.
- Weights, severity caps (P0 → dimension max 40) and the 70/15/15 mission formula are v0.1 hypotheses.
- Not yet validated on real sites (sandbox has no general internet).
