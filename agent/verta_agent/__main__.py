import argparse, json, os, sys
from . import mission as M
from .agent import run
from .brain import HeuristicBrain, LLMBrain
from .report import build, to_markdown, to_html


def main(argv=None):
    ap = argparse.ArgumentParser(prog="verta_agent", description="Run VERTA procurement missions against a store (no real orders).")
    ap.add_argument("url"); ap.add_argument("--query", required=True, help="product to look for")
    ap.add_argument("--attribute", default="pressure rating"); ap.add_argument("--out", default="verta-run")
    ap.add_argument("--missions", help="mission JSON file (list or single)"); ap.add_argument("--llm", action="store_true")
    ap.add_argument("--basic", action="store_true", help="skip quantity-change and shipping/tax missions")
    ap.add_argument("--login", action="store_true", help="log in first; reads VERTA_LOGIN_USER / VERTA_LOGIN_PASSWORD from the environment")
    ap.add_argument("--payment-test", action="store_true", help="AUTHORIZED stores only: submit checkout with a processor TEST card")
    ap.add_argument("--authorization-ref", help="reference to the merchant's written authorization (required for --payment-test)")
    ap.add_argument("--authorized-hosts", default="", help="comma-separated hosts the merchant authorized for payment tests")
    ap.add_argument("--test-profile", help="JSON file: email,first,last,address,city,postal,phone,card,exp,cvc (card must be a known test number)")
    a = ap.parse_args(argv)
    if a.missions:
        d = json.load(open(a.missions)); ms = []
        for x in (d if isinstance(d, list) else [d]):
            json.dump(x, open(a.out + ".tmp.json", "w")); ms.append(M.load(a.out + ".tmp.json"))
        os.remove(a.out + ".tmp.json")
    else:
        ms = M.default_suite(a.query, a.attribute, login=a.login, payment_test=a.payment_test, full_cycle=not a.basic)
    os.makedirs(a.out, exist_ok=True)
    creds = policy = prof = None
    from urllib.parse import urlparse
    host = urlparse(a.url).hostname
    if a.login or any(x["type"] == "login" for x in ms):
        creds = {"user": os.environ.get("VERTA_LOGIN_USER", ""), "password": os.environ.get("VERTA_LOGIN_PASSWORD", "")}
        if not creds["user"] or not creds["password"]: sys.exit("Set VERTA_LOGIN_USER and VERTA_LOGIN_PASSWORD (a test account the merchant gave you).")
        policy = {"login": True}
    if a.payment_test:
        from .safety import authorize_payment_test
        if not a.test_profile: sys.exit("--payment-test needs --test-profile")
        prof = json.load(open(a.test_profile))
        ok, why = authorize_payment_test(host, [h.strip() for h in a.authorized_hosts.split(",") if h.strip()], a.authorization_ref, prof.get("card", "").replace(" ", ""))
        if not ok: sys.exit(f"Payment test refused: {why}")
        prof["card"] = prof["card"].replace(" ", "")
        policy = dict(policy or {}, payment=True)
    data, store = run(a.url, ms, a.out, LLMBrain() if a.llm else HeuristicBrain(), creds=creds, test_profile=prof, policy=policy)
    rep = build(data, store)
    json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=2)
    md = to_markdown(rep, store)
    open(os.path.join(a.out, "report.md"), "w").write(md)
    open(os.path.join(a.out, "report.html"), "w").write(to_html(md))
    print(f"{rep['merchant']['host']}: {rep['overall_score']}/100 {rep['classification']} · blockers={len(rep['critical_blockers'])} · {a.out}/report.md")


if __name__ == "__main__":
    main()
