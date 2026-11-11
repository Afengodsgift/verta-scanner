"""Agent loop: Mission -> Brain -> Validator -> Controller -> Observer -> Evidence -> Evaluator."""
import json, os, time
from urllib.parse import urlparse
from . import mission as M, safety
from .evidence import EvidenceStore
from .controller import Controller
from .brain import HeuristicBrain
from .evaluator import evaluate
from .failures import TAXONOMY


def run_mission(m, ctl, brain, store, shared, host):
    t0 = time.time()
    res = dict(mission_id=m["mission_id"], type=m["type"], dimension=m["dimension"], objective=m["objective"],
               status="RUNNING", failure_code=None, evidence_ids=[], action_errors=0, steps=0)
    # entry point
    if m["type"] in ("discover_product", "login"):
        ctl.execute({"action": "goto", "url": shared["entry"]})
    elif m["type"] == "payment_test":
        if not shared.get("checkout_url"):
            res.update(status="SKIPPED", summary="Dependency not met: checkout was not reached."); return res
        ctl.execute({"action": "goto", "url": shared["checkout_url"]})
    elif shared.get("product_url"):
        ctl.execute({"action": "goto", "url": shared["product_url"]}) if m["type"] not in ("reach_checkout",) else None
    else:
        res.update(status="SKIPPED", summary="Dependency not met: no product page was discovered.")
        return res
    obs, hist, extracts = ctl.observe(), [], []
    budget = m["budget"]
    for step in range(budget["max_steps"]):
        if time.time() - t0 > budget["timeout_s"]:
            res.update(status="TIMEOUT", failure_code="TIMEOUT"); break
        action = brain.next_action(m, obs, hist, shared)
        res["steps"] = step + 1
        if action["action"] == "extract":
            shot = ctl.screenshot(os.path.join(store.dir, "screenshots", f"{m['mission_id']}-{step}.png"))
            eid = store.add(m["mission_id"], obs["url"], "extract:" + action["tag"], json.dumps(action["data"])[:300], screenshot=shot,
                            dom_excerpt=obs["text"][:600], kind=action["tag"], data=action["data"])
            res["evidence_ids"].append(eid)
            extracts.append({"tag": action["tag"], "data": action["data"], "eid": eid})
            store.log(m["mission_id"], step, {"action": action, "brain": brain.name})
            break
        if action["action"] == "finish":
            store.log(m["mission_id"], step, {"action": action, "brain": brain.name}); break
        if action.get("action") == "fill" and action.get("fill_from"):  # resolve secrets locally; the model never sees them
            k = action["fill_from"]
            src = {"login_user": (shared.get("creds") or {}).get("user"), "login_password": (shared.get("creds") or {}).get("password")}.get(k) or (shared.get("test_profile") or {}).get(k)
            action = dict(action, value=src or "", secret=True)
        el = ctl.element(obs, action.get("id")) if "id" in action else None
        ctx = dict(policy=shared.get("policy"), mission_type=m["type"], allowed_host=host, step=step, max_steps=budget["max_steps"],
                   element_text=(el or {}).get("text", ""), field=(el or {}).get("name", "") + (el or {}).get("placeholder", ""))
        try:
            ok, why = safety.validate(action, ctx)
        except safety.SafetyStop as e:
            eid = store.add(m["mission_id"], obs["url"], "safety_stop", str(e), kind="safety")
            res.update(status="SAFETY_STOP", summary=str(e)); res["evidence_ids"].append(eid); return res
        if not ok:
            res["action_errors"] += 1
            store.log(m["mission_id"], step, {"action": dict(action, value="[redacted]") if action.get("secret") else action, "rejected": why}); hist.append({"action": action}); continue
        r = ctl.execute(action)
        if not r["ok"]: res["action_errors"] += 1
        logged = dict(action, value="[redacted]") if action.get("secret") or (action["action"] == "fill" and m["type"] != "discover_product") else action
        store.log(m["mission_id"], step, {"action": logged, "result": r, "url": ctl.url, "brain": brain.name})
        hist.append({"action": action})
        obs = ctl.observe()
    if res["status"] == "TIMEOUT":
        return res
    ev = evaluate(m, extracts)
    res.update(ev)
    if m["type"] == "discover_product" and ev["status"] == "SUCCESS":
        shared["product_url"] = extracts[0]["data"]["url"]; shared["product_title"] = extracts[0]["data"].get("title", "")
    if m["type"] == "reach_checkout" and ev["status"] == "SUCCESS": shared["checkout_url"] = ctl.url
    res.setdefault("summary", ev["summary"])
    if res["failure_code"] and not res["evidence_ids"]:
        res["evidence_ids"].append(store.add(m["mission_id"], ctl.url, "no_conclusion", "Mission ended without conclusive observation", confidence="LOW", kind="note"))
    return res


def run(site_url, missions, outdir, brain=None, headless=True, creds=None, test_profile=None, policy=None):
    brain = brain or HeuristicBrain()
    u = urlparse(site_url)
    host = u.hostname
    store = EvidenceStore(outdir)
    ctl = Controller(headless=headless)
    shared = {"entry": site_url, "creds": creds, "test_profile": test_profile, "policy": policy or {}}
    results = []
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        for m in missions:
            try:
                results.append(run_mission(m, ctl, brain, store, shared, host))
            except Exception as e:  # system error: excluded from scoring, never silently dropped
                results.append(dict(mission_id=m["mission_id"], type=m["type"], dimension=m["dimension"], objective=m["objective"],
                                    status="SYSTEM_ERROR", failure_code="SYSTEM_ERROR", evidence_ids=[], action_errors=0, summary=str(e)[:200]))
    finally:
        ctl.close()
    store.save()
    return dict(site=site_url, host=host, started=started, finished=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                brain=brain.name, results=results), store
