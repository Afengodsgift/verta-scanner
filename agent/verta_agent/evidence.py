"""Immutable-ish evidence store: append-only items with IDs, per Evidence Schema v0.1 (condensed)."""
import json, os, time, hashlib


class EvidenceStore:
    def __init__(self, outdir):
        self.dir = outdir
        os.makedirs(os.path.join(outdir, "screenshots"), exist_ok=True)
        self.items = []
        self.trace = []
        self._n = 0

    def add(self, mission_id, url, action, observation, confidence="HIGH", screenshot=None, dom_excerpt=None, kind="observation", data=None):
        self._n += 1
        eid = f"EV-{self._n:05d}"
        item = {"evidence_id": eid, "mission_id": mission_id, "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "url": url, "action": action, "observation": observation, "kind": kind, "confidence": confidence,
                "screenshot": screenshot, "dom_excerpt": (dom_excerpt or "")[:600], "data": data or {}}
        item["sha256"] = hashlib.sha256(json.dumps(item, sort_keys=True).encode()).hexdigest()[:16]
        self.items.append(item)
        return eid

    def log(self, mission_id, step, entry):
        self.trace.append({"mission_id": mission_id, "step": step, **entry})

    def get(self, eid):
        return next((i for i in self.items if i["evidence_id"] == eid), None)

    def save(self):
        with open(os.path.join(self.dir, "evidence.json"), "w") as f:
            json.dump(self.items, f, indent=2)
        with open(os.path.join(self.dir, "trace.json"), "w") as f:
            json.dump(self.trace, f, indent=2)
