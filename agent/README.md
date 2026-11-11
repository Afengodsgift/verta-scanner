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

## Safety
Validator allows only goto/click/fill/press/extract/wait/finish; same-host only; any click on pay/place-order controls or any fill of payment/credential fields ends the mission with `SAFETY_STOP`. No real orders or payments, ever. The agent stops at the checkout page.

## Honest status
- Heuristic brain is tested on fixtures only; LLM brain is untested without an API key.
- Not assessed yet (excluded from overall, stated in report): Search & Navigation, Quoting/RFQ, Authorization/Security.
- Weights, severity caps (P0 → dimension max 40) and the 70/15/15 mission formula are v0.1 hypotheses.
- Not yet validated on real sites (sandbox has no general internet).
