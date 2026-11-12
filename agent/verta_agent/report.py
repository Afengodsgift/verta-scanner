"""Report generator: scoring + results + evidence -> canonical report object -> MD / HTML. No raw-log reconstruction."""
import html, json
from . import REPORT_VERSION, SCORE_VERSION
from .failures import TAXONOMY, INVALID
from .scoring import score as do_score, NOT_ASSESSED_MVP

DIM_LABEL = {"discoverability": "Discoverability", "product_understanding": "Product Understanding", "pricing": "Pricing",
             "inventory": "Inventory", "search_navigation": "Search & Navigation", "quoting_rfq": "Quoting / RFQ",
             "transaction": "Transaction / Checkout", "authorization_security": "Authorization / Security"}
BAND_TEXT = {"AGENT_READY": "Agents can complete the tested workflow reliably.",
             "AGENT_COMPATIBLE": "Agents can complete most of the tested workflow with limited friction.",
             "AGENT_FRICTION": "Agents can interact with meaningful portions of the commerce experience, but important obstacles can prevent reliable autonomous purchasing.",
             "AGENT_BLIND": "Agents are largely unable to complete the tested workflow.",
             "INCONCLUSIVE": "Not enough valid missions to score."}
MARK = {"AGENT_READY": "🟢", "AGENT_COMPATIBLE": "🟡", "AGENT_FRICTION": "🟠", "AGENT_BLIND": "🔴", "NOT_ASSESSED": "⚪"}
LIMITS = ["Tests represent the tested environment, missions and date only.",
          "Agent behavior can vary by model and configuration; this run used the brain named in the methodology.",
          "A successful mission does not prove every possible agent workflow will succeed.",
          "Scores use VERTA scoring model v0.1; weights are experimental hypotheses, not an industry certification.",
          "Search & Navigation, Quoting/RFQ and Authorization/Security are not yet assessed by the MVP and are excluded from the overall score.",
          "No real orders or payments were made; checkout was observed only up to the payment step.",
          "Protocol compatibility is not inferred from generic APIs or structured data."]


def build(run_data, store):
    results = run_data["results"]
    sc = do_score(results)
    findings, n = [], 0
    for r in results:
        code = r.get("failure_code")
        if code and code in TAXONOMY and code not in INVALID:
            n += 1; tx = TAXONOMY[code]
            findings.append(dict(finding_id=f"VRTA-F-{n:04d}", title=tx["title"], severity=tx["sev"], dimension=tx["dim"] or r["dimension"],
                mission=r["mission_id"], observation=r.get("summary"), evidence=r["evidence_ids"], root_cause=r.get("root_cause") or tx["cause"],
                business_consequence=tx["impact"], recommendation=tx["fix"], category=tx["cat"], failure_code=code, priority=tx["sev"]))
    order = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}
    findings.sort(key=lambda f: order[f["severity"]])
    blockers = [f for f in findings if f["severity"] == "P0"]
    roadmap = {k: [dict(finding=f["finding_id"], action=f["recommendation"], category=f["category"]) for f in findings if f["severity"] == p]
               for k, p in (("p0", "P0"), ("p1", "P1"), ("p2", "P2"))}
    ev_ids = sorted({e for r in results for e in r["evidence_ids"]})
    inconclusive = [dict(mission=r["mission_id"], status=r["status"], note=r.get("summary")) for r in results if r["status"] in ("SKIPPED", "TIMEOUT", "SYSTEM_ERROR", "SAFETY_STOP")]
    rep = dict(report_version=REPORT_VERSION, score_version=SCORE_VERSION,
        merchant=dict(site=run_data["site"], host=run_data["host"]),
        overall_score=sc["overall"], classification=sc["classification"], dimensions=sc["dimensions"], coverage_weight_pct=sc["coverage_weight_pct"],
        missions=[{k: r.get(k) for k in ("mission_id", "type", "dimension", "objective", "status", "failure_code", "confidence", "summary", "mission_score", "evidence_ids", "steps")} for r in results],
        critical_blockers=blockers, findings=findings, recommendations=sorted({(f["category"], f["recommendation"]) for f in findings}),
        roadmap=roadmap, evidence_refs=ev_ids, inconclusive=inconclusive,
        methodology=dict(brain=run_data["brain"], started=run_data["started"], finished=run_data["finished"], missions_executed=len(results),
                         browser="Chromium via Playwright (headless), honest UA VertaAgent/0.1", scoring="capability 70% + evidence quality 15% + recovery 15%; P0 failures cap a dimension at 40",
                         evidence="Every extract/safety event stored with screenshot, DOM excerpt, timestamp and hash",
                         verification=f"Claims are checked against the page before they count; {sum(1 for e in store.items if (e.get('data') or {}).get('_claimed'))} claim(s) were rejected in this run"),
        limitations=LIMITS)
    rep["recommendations"] = [dict(category=c, action=a) for c, a in rep["recommendations"]]
    rep["quality_checks"] = quality(rep, store)
    return rep


def quality(rep, store):
    ids = {i["evidence_id"] for i in store.items}
    return {"evidence_refs_resolve": all(e in ids for f in rep["findings"] for e in f["evidence"]) and all(e in ids for e in rep["evidence_refs"]),
            "every_finding_has_evidence": all(f["evidence"] for f in rep["findings"]),
            "every_finding_has_priority": all(f["priority"] for f in rep["findings"]),
            "critical_blockers_surfaced": len(rep["critical_blockers"]) == sum(1 for f in rep["findings"] if f["severity"] == "P0"),
            "score_version_recorded": bool(rep["score_version"]), "limitations_included": bool(rep["limitations"])}


def to_markdown(rep, store):
    L = [f"# VERTA Agent Readiness Report", f"**{rep['merchant']['host']}** · scoring v{rep['score_version']} · {rep['methodology']['finished']}", ""]
    c = rep["classification"]
    L += ["## Overall", f"### {rep['overall_score']} / 100 — {c.replace('_', ' ')} {MARK.get(c, '')}", BAND_TEXT[c], "",
          f"_Overall covers {rep['coverage_weight_pct']}% of the scoring model (dimensions the MVP assesses)._", ""]
    if rep["critical_blockers"]:
        L += ["## Critical blockers"]
        for b in rep["critical_blockers"]:
            L += [f"### 🔴 {b['title']}", f"- **Affected:** {DIM_LABEL.get(b['dimension'], b['dimension'])} (mission {b['mission']})", f"- **What happened:** {b['observation']}",
                  f"- **Business consequence:** {b['business_consequence']}", f"- **Evidence:** {', '.join(b['evidence'])}", f"- **Recommended action:** {b['recommendation']}", ""]
    L += ["## Readiness profile", "| Dimension | Score | |", "|---|---|---|"]
    for d, v in rep["dimensions"].items():
        L.append(f"| {DIM_LABEL[d]} | {v['score'] if v['score'] is not None else 'not assessed'} | {MARK[v['band']]} |")
    L += ["", "## What we tested"]
    for m in rep["missions"]:
        ok = {"SUCCESS": "✅", "FAILED": "❌", "SKIPPED": "⏭️", "SAFETY_STOP": "🛑"}.get(m["status"], "⚠️")
        L.append(f"- {ok} **{m['mission_id']}** {m['objective']} — {m['summary'] or m['status']} ({', '.join(m['evidence_ids']) or 'no evidence'})")
    L += ["", "## Findings"]
    for f in rep["findings"]:
        L += [f"### {f['finding_id']} · {f['title']}", f"- **Severity:** {f['severity']} · **Dimension:** {DIM_LABEL.get(f['dimension'], f['dimension'])} · **Mission:** {f['mission']}",
              f"- **Observation:** {f['observation']}", f"- **Root cause:** {f['root_cause']}", f"- **Business consequence:** {f['business_consequence']}",
              f"- **Recommendation ({f['category']}):** {f['recommendation']}", f"- **Evidence:** {', '.join(f['evidence'])}", ""]
    if not rep["findings"]: L += ["No failures observed in the tested missions.", ""]
    L += ["## Priority roadmap"]
    for k, lab in (("p0", "P0 — NOW"), ("p1", "P1 — NEXT"), ("p2", "P2 — LATER")):
        L.append(f"**{lab}**")
        L += [f"{i}. {x['action']} _({x['finding']})_" for i, x in enumerate(rep["roadmap"][k], 1)] or ["- none"]
    if rep["inconclusive"]:
        L += ["", "## Not assessed / inconclusive"] + [f"- {i['mission']}: {i['status']} — {i['note']}" for i in rep["inconclusive"]]
    L += ["", "## Evidence appendix", "| ID | Mission | URL | Action | Observation | Screenshot | Conf |", "|---|---|---|---|---|---|---|"]
    for e in store.items:
        L.append(f"| {e['evidence_id']} | {e['mission_id']} | {e['url']} | {e['action']} | {e['observation'][:90].replace('|', '/')} | {e['screenshot'] or '-'} | {e['confidence']} |")
    me = rep["methodology"]
    L += ["", "## Methodology", f"- Missions executed: {me['missions_executed']}", f"- Brain: {me['brain']}", f"- Browser: {me['browser']}", f"- Scoring: {me['scoring']}", f"- Evidence: {me['evidence']}",
          "", "## Limitations"] + [f"- {x}" for x in rep["limitations"]]
    L += ["", "## Report quality checks"] + [f"- [{'x' if v else ' '}] {k}" for k, v in rep["quality_checks"].items()]
    return "\n".join(L) + "\n"


def to_html(md):
    import subprocess
    body = subprocess.run(["pandoc", "-f", "gfm", "-t", "html"], input=md, capture_output=True, text=True).stdout
    css = "body{font:16px/1.55 system-ui;max-width:860px;margin:0 auto;padding:16px;color:#111}table{border-collapse:collapse;width:100%;font-size:14px;display:block;overflow-x:auto}td,th{border:1px solid #ddd;padding:6px 8px}h3{margin-top:1.4em}"
    return f"<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>VERTA Report</title><style>{css}</style>{body}"
