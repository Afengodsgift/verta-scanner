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


if __name__ == "__main__":
    unittest.main(verbosity=2)
