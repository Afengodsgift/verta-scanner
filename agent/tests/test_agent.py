import os, sys, json, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tests import fixture_store
from verta_agent import mission as M, safety
from verta_agent.agent import run
from verta_agent.report import build, to_markdown
from verta_agent.scoring import band

srv, BASE = fixture_store.start()
CACHE = {}


def audit(v):
    if v not in CACHE:
        d = tempfile.mkdtemp()
        data, store = run(f"{BASE}/{v}/", M.default_suite("stainless ball valve", "pressure rating"), d)
        CACHE[v] = (data, store, build(data, store), d)
    return CACHE[v]


def codes(v): return {r["mission_id"]: r.get("failure_code") for r in audit(v)[0]["results"]}


class T(unittest.TestCase):
    def test_good_store_scores_high(self):
        rep = audit("good")[2]
        self.assertGreaterEqual(rep["overall_score"], 80, rep["missions"])
        self.assertEqual(rep["critical_blockers"], [])
        self.assertTrue(all(codes("good")[k] is None for k in codes("good")), codes("good"))

    def test_pdf_store_finds_failures(self):
        c = codes("pdf")
        self.assertEqual(c["M-0002"], "ATTRIBUTE_UNAVAILABLE")
        self.assertEqual(c["M-0003"], "PRICE_UNAVAILABLE")
        self.assertEqual(c["M-0004"], "INVENTORY_UNAVAILABLE")
        self.assertEqual(c["M-0005"], "CART_BLOCKED")
        rep = audit("pdf")[2]
        self.assertTrue(any("PDF" in (f["root_cause"] or "") for f in rep["findings"]))
        self.assertLess(rep["overall_score"], 60)
        self.assertGreaterEqual(len(rep["critical_blockers"]), 1)

    def test_gated_store(self):
        c = codes("gated")
        self.assertEqual(c["M-0002"], None)  # attribute in text table
        self.assertEqual(c["M-0003"], "PRICE_AUTH_REQUIRED")
        self.assertEqual(c["M-0006"], "HUMAN_ONLY_INTERACTION")

    def test_ordering(self):
        s = {v: audit(v)[2]["overall_score"] for v in ("good", "gated", "pdf")}
        self.assertGreater(s["good"], s["gated"]); self.assertGreater(s["gated"], s["pdf"])

    def test_checkout_stops_before_payment(self):
        data, store, rep, d = audit("good")
        self.assertEqual(codes("good")["M-0006"], None)
        self.assertFalse(any(e["action"] == "safety_stop" for e in store.items))
        self.assertFalse(any(t["action"].get("action") == "fill" for t in store.trace if t["mission_id"] == "M-0006"))

    def test_report_quality_checks_pass(self):
        for v in ("good", "pdf", "gated"):
            q = audit(v)[2]["quality_checks"]
            self.assertTrue(all(q.values()), (v, q))

    def test_report_markdown_and_evidence_files(self):
        data, store, rep, d = audit("pdf")
        md = to_markdown(rep, store)
        self.assertIn("Critical blockers", md); self.assertIn("EV-00001", md)
        self.assertTrue(os.path.exists(os.path.join(d, "evidence.json")))
        self.assertTrue(any(f.endswith(".png") for f in os.listdir(os.path.join(d, "screenshots"))))

    def test_validator(self):
        ctx = dict(allowed_host="a.com", step=0, max_steps=5, element_text="", field="")
        self.assertFalse(safety.validate({"action": "goto", "url": "https://evil.com/x"}, ctx)[0])
        self.assertFalse(safety.validate({"action": "eval", "js": "1"}, ctx)[0])
        self.assertTrue(safety.validate({"action": "goto", "url": "https://a.com/x"}, ctx)[0])
        with self.assertRaises(safety.SafetyStop):
            safety.validate({"action": "click", "id": 1}, dict(ctx, element_text="Place order"))
        with self.assertRaises(safety.SafetyStop):
            safety.validate({"action": "fill", "id": 1, "value": "4242"}, dict(ctx, field="card_number"))

    def test_p0_caps_dimension(self):
        rep = audit("pdf")[2]
        self.assertEqual(rep["dimensions"]["transaction"]["p0_capped"], True)
        self.assertLessEqual(rep["dimensions"]["transaction"]["score"], 40)

    def test_dependency_skip_and_not_assessed(self):
        d = tempfile.mkdtemp()
        data, store = run(f"{BASE}/nope/", M.default_suite("zzz"), d)
        rep = build(data, store)
        self.assertEqual(rep["missions"][0]["failure_code"], "PRODUCT_NOT_DISCOVERABLE")
        self.assertTrue(all(m["status"] == "SKIPPED" for m in rep["missions"][1:]))
        self.assertEqual(rep["dimensions"]["quoting_rfq"]["band"], "NOT_ASSESSED")

    def test_bands(self):
        self.assertEqual([band(x) for x in (90, 70, 56, 10)], ["AGENT_READY", "AGENT_COMPATIBLE", "AGENT_FRICTION", "AGENT_BLIND"])


PROFILE = dict(email="buyer@test.dev", first="Test", last="Buyer", address="1 Test St", city="Lagos", postal="100001", phone="08000000000", card="4000000000000002", exp="12/30", cvc="123")


def pay_run(card, creds=("buyer@test.dev", "s3cret"), payment=True):
    d = tempfile.mkdtemp()
    ms = M.default_suite("stainless ball valve", "pressure rating", login=True, payment_test=payment)
    fixture_store.H.orders.clear(); fixture_store.H.logged.clear()
    data, store = run(f"{BASE}/pay/", ms, d, creds=dict(user=creds[0], password=creds[1]),
                      test_profile=dict(PROFILE, card=card), policy=dict(login=True, payment=payment))
    return data, store, build(data, store), d


class TAuth(unittest.TestCase):
    def test_login_then_declined_card_counts_as_working_checkout(self):
        data, store, rep, d = pay_run("4000000000000002")
        c = {r["type"]: r for r in data["results"]}
        self.assertEqual(c["login"]["status"], "SUCCESS", c["login"])
        self.assertEqual(c["reach_checkout"]["status"], "SUCCESS")
        self.assertEqual(c["payment_test"]["status"], "SUCCESS")
        self.assertIn("decline", c["payment_test"]["summary"])
        self.assertEqual(len(fixture_store.H.orders), 1)
        self.assertEqual(rep["dimensions"]["authorization_security"]["band"] != "NOT_ASSESSED", True)

    def test_secrets_never_stored(self):
        data, store, rep, d = pay_run("4000000000000002")
        blob = json.dumps(store.items) + json.dumps(store.trace) + open(os.path.join(d, "evidence.json")).read() + open(os.path.join(d, "trace.json")).read()
        for secret in ("s3cret", "4000000000000002", "buyer@test.dev"):
            self.assertNotIn(secret, blob)

    def test_bad_login_is_a_finding(self):
        data, store, rep, d = pay_run("4000000000000002", creds=("buyer@test.dev", "wrong"), payment=False)
        c = {r["type"]: r for r in data["results"]}
        self.assertEqual(c["login"]["failure_code"], "LOGIN_FAILED")
        self.assertEqual(c["reach_checkout"]["status"], "FAILED")  # login wall
        self.assertEqual(c["reach_checkout"]["failure_code"], "AUTH_REQUIRED")

    def test_without_policy_payment_fields_are_a_safety_stop(self):
        d = tempfile.mkdtemp()
        ms = M.default_suite("stainless ball valve", "pressure rating", login=True, payment_test=True)
        fixture_store.H.logged.clear(); fixture_store.H.orders.clear()
        data, store = run(f"{BASE}/pay/", ms, d, creds=dict(user="buyer@test.dev", password="s3cret"), test_profile=PROFILE, policy=dict(login=True))
        pt = [r for r in data["results"] if r["type"] == "payment_test"][0]
        self.assertEqual(pt["status"], "SAFETY_STOP")
        self.assertEqual(fixture_store.H.orders, [])

    def test_authorization_gates(self):
        a = safety.authorize_payment_test
        self.assertTrue(a("shop.com", ["shop.com"], "AUTH-2026-001", "4242424242424242")[0])
        self.assertFalse(a("shop.com", [], "AUTH-2026-001", "4242424242424242")[0])
        self.assertFalse(a("shop.com", ["shop.com"], "", "4242424242424242")[0])
        self.assertFalse(a("shop.com", ["shop.com"], "AUTH-2026-001", "5100000000000008")[0])
        self.assertFalse(a("nalgene.com", ["shop.com"], "AUTH-2026-001", "4242424242424242")[0])


import re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from verta_agent.brain import LLMBrain


def mock_llm(mode="script"):
    """Fake Anthropic API: checks request shape and answers from a script keyed on the prompt. Tests plumbing, not intelligence."""
    seen = []

    class Hd(BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            seen.append(body)
            if mode == "down":
                self.send_response(500); self.end_headers(); return
            u = body["messages"][0]["content"]
            def eid(rx):
                m = re.search(r"\[(\d+)\] " + rx, u); return int(m.group(1)) if m else None
            if "MISSION: Find a product" in u:
                if "Search products" in u and "fill" not in u: a = {"reasoning": "use search", "action": "fill", "id": eid(r"input/search"), "value": "stainless ball valve"}
                elif '"press"' not in u and "No results" not in u and "Results for" not in u: a = {"reasoning": "submit", "action": "press", "key": "Enter"}
                elif "Results for" in u and "Add to cart" not in u: a = {"reasoning": "open top hit", "action": "click", "id": eid(r'a "Stainless Steel Ball Valve')}
                else: a = {"reasoning": "this is the product page", "action": "extract", "tag": "product_page", "data": {"url": re.search(r"URL: (\S+)", u).group(1), "title": "Stainless Steel Ball Valve 1 inch"}}
            else:
                a = {"reasoning": "price in JSON-LD", "action": "extract", "tag": "price", "data": {"price": "84.50", "currency": "USD", "source": "structured", "gated": None}}
            out = json.dumps({"content": [{"type": "tool_use", "id": "t", "name": "act", "input": a}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Hd)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, seen, f"http://127.0.0.1:{srv.server_address[1]}"


class TLLM(unittest.TestCase):
    def setUp(self): os.environ["ANTHROPIC_API_KEY"] = "test-key"

    def test_llm_brain_drives_missions_and_never_sees_secrets(self):
        srv, seen, base = mock_llm()
        d = tempfile.mkdtemp()
        ms = [m for m in M.default_suite("stainless ball valve") if m["type"] in ("discover_product", "get_price")]
        data, store = run(f"{BASE}/good/", ms, d, brain=LLMBrain(base_url=base, fallback=False), creds=dict(user="buyer@test.dev", password="s3cret"))
        self.assertEqual([r["status"] for r in data["results"]], ["SUCCESS", "SUCCESS"], data["results"])
        r = seen[0]
        self.assertEqual(r["tool_choice"], {"type": "tool", "name": "act"}); self.assertEqual(r["tools"][0]["name"], "act")
        self.assertNotIn("s3cret", json.dumps(seen)); self.assertTrue(any("reasoning" in str(t["action"]) for t in store.trace))
        self.assertTrue(data["brain"].startswith("llm:"))
        srv.shutdown()

    def test_llm_outage_falls_back_to_heuristic_and_is_flagged(self):
        srv, seen, base = mock_llm("down")
        d = tempfile.mkdtemp(); b = LLMBrain(base_url=base)
        ms = [m for m in M.default_suite("stainless ball valve") if m["type"] == "discover_product"]
        data, store = run(f"{BASE}/good/", ms, d, brain=b)
        self.assertEqual(data["results"][0]["status"], "SUCCESS"); self.assertGreater(b.fell_back, 0)
        self.assertTrue(any("heuristic fallback" in json.dumps(t) for t in store.trace))
        srv.shutdown()


if __name__ == "__main__":
    unittest.main(verbosity=2)
