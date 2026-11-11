"""Scoring Engine v0.1 (experimental weights). Capability 70% + evidence quality 15% + recovery 15%."""
from .failures import TAXONOMY, INVALID

WEIGHTS = {"discoverability": 15, "product_understanding": 20, "pricing": 12.5, "inventory": 12.5,
           "search_navigation": 10, "quoting_rfq": 10, "transaction": 15, "authorization_security": 5}
NOT_ASSESSED_MVP = ["search_navigation", "quoting_rfq", "authorization_security"]
CONF = {"HIGH": 1.0, "MEDIUM": 0.75, "LOW": 0.4}
P0_CAP = 40


def band(s):
    return "AGENT_READY" if s >= 80 else "AGENT_COMPATIBLE" if s >= 60 else "AGENT_FRICTION" if s >= 40 else "AGENT_BLIND"


def mission_score(r):
    cap = {"SUCCESS": 100, "PARTIAL_SUCCESS": 50}.get(r["status"], 0)
    ev = 100 * CONF.get(r["confidence"], 0.4) if r["evidence_ids"] else 0
    rec = max(0, 100 - 25 * r.get("action_errors", 0))
    # evidence quality and recovery only add credit in proportion to capability: a failed mission scores 0
    return round(0.70 * cap + (0.15 * ev + 0.15 * rec) * (cap / 100), 1)


def score(results):
    """results: list of mission result dicts. Returns scoring object."""
    dims = {}
    valid = [r for r in results if r["status"] not in ("SKIPPED", "SAFETY_STOP") and r.get("failure_code") not in INVALID]
    for r in valid:
        r["mission_score"] = mission_score(r)
        dims.setdefault(r["dimension"], []).append(r)
    out = {}
    for d, rs in dims.items():
        s = sum(x["mission_score"] for x in rs) / len(rs)
        capped = any(TAXONOMY.get(x["failure_code"], {}).get("sev") == "P0" for x in rs)
        if capped and s > P0_CAP: s = P0_CAP
        out[d] = {"score": round(s), "band": band(s), "missions": [x["mission_id"] for x in rs], "p0_capped": capped}
    for d in WEIGHTS:
        if d not in out:
            out[d] = {"score": None, "band": "NOT_ASSESSED", "missions": [], "p0_capped": False}
    wsum = sum(WEIGHTS[d] for d in out if out[d]["score"] is not None)
    overall = round(sum(out[d]["score"] * WEIGHTS[d] for d in out if out[d]["score"] is not None) / wsum) if wsum else None
    return {"overall": overall, "classification": band(overall) if overall is not None else "INCONCLUSIVE",
            "dimensions": out, "weights": WEIGHTS, "coverage_weight_pct": round(100 * wsum / sum(WEIGHTS.values())),
            "score_version": "0.1"}
