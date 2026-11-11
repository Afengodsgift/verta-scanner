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
    a = ap.parse_args(argv)
    if a.missions:
        d = json.load(open(a.missions)); ms = []
        for x in (d if isinstance(d, list) else [d]):
            json.dump(x, open(a.out + ".tmp.json", "w")); ms.append(M.load(a.out + ".tmp.json"))
        os.remove(a.out + ".tmp.json")
    else:
        ms = M.default_suite(a.query, a.attribute)
    os.makedirs(a.out, exist_ok=True)
    data, store = run(a.url, ms, a.out, LLMBrain() if a.llm else HeuristicBrain())
    rep = build(data, store)
    json.dump(rep, open(os.path.join(a.out, "report.json"), "w"), indent=2)
    md = to_markdown(rep, store)
    open(os.path.join(a.out, "report.md"), "w").write(md)
    open(os.path.join(a.out, "report.html"), "w").write(to_html(md))
    print(f"{rep['merchant']['host']}: {rep['overall_score']}/100 {rep['classification']} · blockers={len(rep['critical_blockers'])} · {a.out}/report.md")


if __name__ == "__main__":
    main()
