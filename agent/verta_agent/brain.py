"""Brains propose actions from observations. HeuristicBrain is deterministic (offline, testable);
LLMBrain asks Claude via the Messages API (needs ANTHROPIC_API_KEY). Both return one action dict."""
import json, os, re, urllib.request
from urllib.parse import urljoin

ADD = re.compile(r"add to (cart|basket|bag|order)", re.I)
CHECKOUT = re.compile(r"(proceed to )?checkout|check out", re.I)
CARTLINK = re.compile(r"\b(cart|basket|bag)\b", re.I)
PRICE_RE = re.compile(r"(?:\$|USD\s?|€|£|₦|NGN\s?)\s?\d[\d,]*(?:\.\d{1,2})?")
GATED = re.compile(r"(log ?in|sign ?in|register|account)\s+(to|for)\s+(see|view)?\s*(price|pricing)|(request|get) (a )?quote|contact (us )?for (price|pricing)|call for (price|pricing)|price on request", re.I)
STOCK = re.compile(r"\b(in stock|out of stock|sold out|available|unavailable|backorder|pre-?order|ships? (in|within)|lead time|only \d+ left|\d+ (units )?(in stock|available))", re.I)
CAPTCHA = re.compile(r"(captcha|verify you are human|are you a robot|cloudflare|hcaptcha)", re.I)


def toks(s): return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if len(w) > 2}


PRODUCT_PATH = re.compile(r"/(products?|p|item|items|sku)/[^/?#]+/?$", re.I)


def is_product_page(obs):
    """Product signals: structured Product data, an add-to-cart control, or a product-style URL with a price/quote cue."""
    if obs["product_ld"] or any(ADD.search(e["text"]) for e in obs["elements"] if e["tag"] in ("button", "input", "a")):
        return True
    from urllib.parse import urlparse
    return bool(PRODUCT_PATH.search(urlparse(obs["url"]).path)) and bool(PRICE_RE.search(obs["text"]) or GATED.search(obs["text"]) or STOCK.search(obs["text"]) or re.search(r"datasheet|specification|sku", obs["text"], re.I))


def find_attr(obs, attr):
    """Return (value, source) or (None, hint). Sources: structured | table | text."""
    key = re.escape(attr.lower())
    for p in obs["product_ld"]:
        for ap in p.get("additionalProperty", []) or []:
            if isinstance(ap, dict) and attr.lower() in str(ap.get("name", "")).lower():
                return str(ap.get("value")), "structured"
    text = obs["text"]
    m = re.search(rf"{key}\s*[:\-–\t ]\s*([^\n]{{1,60}})", text, re.I)
    if m and m.group(1).strip():
        return m.group(1).strip(), "text"
    pdf = [e for e in obs["elements"] if e["href"].lower().split("?")[0].endswith(".pdf")]
    if pdf:
        return None, "pdf_only"
    return None, "absent"


DECLINE = re.compile(r"declin|card was|payment (failed|error|could not)|invalid (card|number)|your card|card number is (incorrect|invalid)|insufficient", re.I)
ACCEPT = re.compile(r"order (confirmed|received|placed|number)|thank you for your (order|purchase)", re.I)
LOGINLINK = re.compile(r"log ?in|sign ?in|my account", re.I)
FIELD_MAP = [("email", r"email"), ("first", r"first.?name|given"), ("last", r"last.?name|family|surname"), ("name", r"full.?name|^name|cardholder"),
             ("address", r"address|street"), ("city", r"city|town"), ("postal", r"zip|postal|post.?code"), ("phone", r"phone|tel"),
             ("card", r"card.?number|cardnumber|cc-number|\bcard\b"), ("exp", r"expir|exp"), ("cvc", r"cvc|cvv|security")]


class HeuristicBrain:
    name = "heuristic-v0.1"

    def next_action(self, mission, obs, hist, shared):
        t = mission["type"]
        step = len(hist)
        return getattr(self, "_" + t)(mission, obs, hist, shared, step)

    # --- helpers
    def _did(self, hist, kind):
        return any(h["action"].get("action") == kind or h["action"].get("tag") == kind for h in hist)

    def _login(self, m, obs, hist, shared, step):
        creds = shared.get("creds") or {}
        pw = next((e for e in obs["elements"] if e["tag"] == "input" and e["type"] == "password"), None)
        fills = [h["action"] for h in hist if h["action"].get("action") == "fill"]
        clicks = sum(1 for h in hist if h["action"].get("action") == "click")
        if pw and len(fills) < 2:
            if not fills:
                u = next((e for e in obs["elements"] if e["tag"] == "input" and (e["type"] in ("email", "text", "") ) and re.search(r"user|email|login", e["name"] + e["placeholder"] + e["type"], re.I)), None)
                if u: return {"action": "fill", "id": u["id"], "value": creds.get("user", ""), "secret": True}
                return {"action": "extract", "tag": "login", "data": {"logged_in": False, "reason": "no username field found"}}
            return {"action": "fill", "id": pw["id"], "value": creds.get("password", ""), "secret": True}
        acts = [h["action"].get("action") for h in hist]
        submitted = False
        if len(fills) == 2:
            last_fill = max(i for i, a in enumerate(acts) if a == "fill")
            submitted = any(a in ("click", "press") for a in acts[last_fill + 1:])
        if pw and len(fills) == 2 and not submitted:
            b = next((e for e in obs["elements"] if e["tag"] in ("button", "input") and re.search(r"log ?in|sign ?in|submit", e["text"], re.I)), None)
            if b: return {"action": "click", "id": b["id"]}
            return {"action": "press", "key": "Enter"}
        if not pw and not fills and clicks < 1:
            l = next((e for e in obs["elements"] if e["tag"] == "a" and LOGINLINK.search(e["text"] + e["href"])), None)
            if l: return {"action": "click", "id": l["id"]}
            return {"action": "extract", "tag": "login", "data": {"logged_in": False, "reason": "no login link or form found"}}
        if len(fills) == 2:
            still = bool(pw)
            ok = (not still) and bool(re.search(r"log ?out|sign ?out|my account|welcome|hello", obs["text"], re.I)) and not re.search(r"invalid|incorrect|wrong|error", obs["text"], re.I)
            return {"action": "extract", "tag": "login", "data": {"logged_in": ok, "reason": None if ok else "still on login form or error shown"}}
        return {"action": "extract", "tag": "login", "data": {"logged_in": False, "reason": "unexpected page"}}

    def _payment_test(self, m, obs, hist, shared, step):
        prof = shared.get("test_profile") or {}
        done = {h["action"].get("id") for h in hist if h["action"].get("action") == "fill"}
        if any(h["action"].get("action") == "click" for h in hist):
            if not any(h["action"].get("action") == "wait" for h in hist):
                return {"action": "wait", "ms": 2500}
            o = "declined" if DECLINE.search(obs["text"]) else "accepted" if ACCEPT.search(obs["text"]) else "unknown"
            return {"action": "extract", "tag": "payment", "data": {"outcome": o, "excerpt": obs["text"][:200]}}
        for e in obs["elements"]:
            if e["tag"] != "input" or e["id"] in done or e["type"] in ("hidden", "submit", "checkbox", "radio"): continue
            key = e["name"] + " " + e["placeholder"]
            for k, rx in FIELD_MAP:
                if re.search(rx, key, re.I) and prof.get(k):
                    return {"action": "fill", "id": e["id"], "value": prof[k], "secret": True}
        b = next((e for e in obs["elements"] if e["tag"] in ("button", "input") and re.search(r"place order|pay|complete|submit", e["text"], re.I)), None)
        if not b: return {"action": "extract", "tag": "payment", "data": {"outcome": "unknown", "excerpt": "no submit control found"}}
        return {"action": "click", "id": b["id"]}

    def _discover_product(self, m, obs, hist, shared, step):
        q = m["inputs"]["query"]
        if is_product_page(obs):
            return {"action": "extract", "tag": "product_page", "data": {"url": obs["url"], "title": obs["title"]}}
        if step > 0 and hist[-1]["action"].get("action") == "press":
            pass
        search = next((e for e in obs["elements"] if e["tag"] == "input" and (e["type"] in ("search", "text", "") and re.search("search|q", e["name"] + e["placeholder"] + e["type"], re.I))), None)
        searched = any(h["action"].get("action") == "fill" for h in hist)
        if search and not searched:
            return {"action": "fill", "id": search["id"], "value": q}
        if searched and not any(h["action"].get("action") == "press" for h in hist):
            return {"action": "press", "key": "Enter"}
        # results page (or no search box): best matching link
        qt = toks(q)
        clicked = {h["action"].get("id") for h in hist if h["action"].get("action") == "click"}
        best, bs = None, 0
        for e in obs["elements"]:
            if e["tag"] != "a" or e["id"] in clicked: continue
            s = len(qt & toks(e["text"] + " " + e["href"]))
            if re.search(r"/(product|products|p|item|shop)/", e["href"]): s += 1
            if s > bs: best, bs = e, s
        if best and bs > 0:
            return {"action": "click", "id": best["id"]}
        return {"action": "finish", "reason": "no_candidate"}

    def _extract_attribute(self, m, obs, hist, shared, step):
        val, src = find_attr(obs, m["inputs"]["attribute"])
        return {"action": "extract", "tag": "attribute", "data": {"attribute": m["inputs"]["attribute"], "value": val, "source": src}}

    def _get_price(self, m, obs, hist, shared, step):
        text = obs["text"]
        for p in obs["product_ld"]:
            offers = p.get("offers")
            offers = offers if isinstance(offers, list) else [offers] if offers else []
            for o in offers:
                if isinstance(o, dict) and o.get("price") not in (None, ""):
                    return {"action": "extract", "tag": "price", "data": {"price": str(o["price"]), "currency": o.get("priceCurrency"), "source": "structured"}}
        g = GATED.search(text)
        pm = PRICE_RE.search(text)
        if pm and not g:
            return {"action": "extract", "tag": "price", "data": {"price": pm.group(0), "source": "text"}}
        return {"action": "extract", "tag": "price", "data": {"price": None, "gated": g.group(0) if g else None, "source": "none"}}

    def _check_inventory(self, m, obs, hist, shared, step):
        for p in obs["product_ld"]:
            offers = p.get("offers")
            offers = offers if isinstance(offers, list) else [offers] if offers else []
            for o in offers:
                if isinstance(o, dict) and o.get("availability"):
                    return {"action": "extract", "tag": "inventory", "data": {"state": str(o["availability"]).split("/")[-1], "source": "structured"}}
        s = STOCK.search(obs["text"])
        return {"action": "extract", "tag": "inventory", "data": {"state": s.group(0) if s else None, "source": "text" if s else "none"}}

    def _pick_variants(self, obs, hist):
        done = {h["action"].get("id") for h in hist if h["action"].get("action") in ("select", "click")}
        bad = re.compile(r"out of stock|sold out|unavailable", re.I)
        for e in obs["elements"]:
            opts = e.get("options")
            if e["tag"] == "select" and e["id"] not in done and opts:
                ph = re.search(r"select|choose|pick|^-+", opts[0], re.I) is not None
                if e.get("selected", 0) == 0 and ph:
                    pick = next((i for i, t in enumerate(opts) if i > 0 and not bad.search(t)), None)
                    if pick is not None: return {"action": "select", "id": e["id"], "option": pick}
        groups = {}
        for e in obs["elements"]:
            if e["tag"] == "input" and e["type"] == "radio" and e["name"] and not re.search(r"ship|pay|deliver", e["name"], re.I): groups.setdefault(e["name"], []).append(e)
        for name, es in groups.items():
            if not any(x.get("selected") for x in es) and not any(x["id"] in done for x in es):
                pick = next((x for x in es if not x.get("disabled") and not bad.search(x["text"])), None)
                if pick: return {"action": "click", "id": pick["id"]}
        return None

    def _add_to_cart(self, m, obs, hist, shared, step):
        acts = [h["action"] for h in hist]
        added = any(a.get("tag_add") for a in acts)
        addbtn = lambda: next((e for e in obs["elements"] if ADD.search(e["text"])), None)
        if not added:
            v = self._pick_variants(obs, hist)
            if v: return dict(v, variant=True)
            btn = addbtn()
            if not btn:
                return {"action": "extract", "tag": "cart", "data": {"added": False, "reason": "no_add_control", "quote_only": bool(GATED.search(obs["text"]))}}
            return {"action": "click", "id": btn["id"], "tag_add": True}
        if acts and acts[-1].get("variant"):  # a variant was chosen after a failed add: add again
            btn = addbtn()
            if btn: return {"action": "click", "id": btn["id"], "tag_add": True}
        if re.search(r"please (choose|select|pick)|required option|select an option", obs["text"], re.I) and len(hist) < 9:
            v = self._pick_variants(obs, hist)
            if v: return dict(v, variant=True)
        if not self._did(hist, "goto"):
            link = next((e for e in obs["elements"] if e["tag"] == "a" and re.search(r"/cart|/basket", e["href"])), None)
            if link: return {"action": "goto", "url": urljoin(obs["url"], link["href"])}
        title = toks(shared.get("product_title", ""))
        in_cart = bool(title & toks(obs["text"])) and not re.search(r"(cart|basket) is (currently )?empty|no items", obs["text"], re.I)
        return {"action": "extract", "tag": "cart", "data": {"added": in_cart, "cart_url": obs["url"]}}

    def _update_cart(self, m, obs, hist, shared, step):
        acts = [h["action"] for h in hist]
        if not any(a.get("action") == "goto" for a in acts):
            link = next((e for e in obs["elements"] if e["tag"] == "a" and re.search(r"/cart|/basket", e["href"])), None)
            if link and "/cart" not in obs["url"] and "/basket" not in obs["url"]: return {"action": "goto", "url": urljoin(obs["url"], link["href"])}
        q = next((e for e in obs["elements"] if e["tag"] == "input" and (e["type"] == "number" or re.search(r"qty|quantity", e["name"] + e["placeholder"] + e["text"], re.I))), None)
        if not q:
            return {"action": "extract", "tag": "cart_update", "data": {"updated": False, "reason": "no quantity control found"}}
        if not any(a.get("action") == "fill" for a in acts):
            shared["_cart_before"] = re.sub(r"\s+", " ", obs["text"])[:300]
            return {"action": "fill", "id": q["id"], "value": "2"}
        if not any(a.get("tag_upd") for a in acts):
            b = next((e for e in obs["elements"] if e["tag"] in ("button", "input", "a") and re.search(r"update (cart|basket)|apply|update", e["text"], re.I)), None)
            if b: return {"action": "click", "id": b["id"], "tag_upd": True}
            return {"action": "press", "key": "Enter", "tag_upd": True}
        before = shared.pop("_cart_before", "")
        qv = re.search(r"(qty|quantity)\s*:?\s*2\b|\bx\s?2\b|\b2\s?x\b", obs["text"], re.I) or any(e["tag"] == "input" and (e["type"] == "number" or re.search("qty|quantity", e["name"])) and e.get("value") == "2" for e in obs["elements"])
        changed = re.sub(r"\s+", " ", obs["text"])[:300] != before
        return {"action": "extract", "tag": "cart_update", "data": {"updated": bool(qv and changed), "before": "1", "after": "2" if qv else "", "reason": None if (qv and changed) else "cart did not show the new quantity"}}

    def _check_shipping(self, m, obs, hist, shared, step):
        opts, seen = [], set()
        for line in [l.strip() for l in obs["text"].split("\n") if l.strip()]:
            if re.search(r"ship|deliver|pickup|express|standard|courier", line, re.I) and len(line) < 120:
                pm = PRICE_RE.search(line)
                lab = re.sub(PRICE_RE, "", line).strip(" :-–")
                if (pm or re.search(r"\bfree\b", line, re.I)) and lab and lab not in seen:
                    seen.add(lab); opts.append({"label": lab, "price": pm.group(0) if pm else "free"})
        tax = bool(re.search(r"\b(tax|vat|gst)\b", obs["text"], re.I))
        return {"action": "extract", "tag": "shipping", "data": {"options": opts, "tax_shown": tax, "reason": None if opts else "no shipping options with a price on the checkout/cart page"}}

    def _reach_checkout(self, m, obs, hist, shared, step):
        if CAPTCHA.search(obs["text"]):
            return {"action": "extract", "tag": "checkout", "data": {"reached": False, "blocker": "captcha"}}
        pay_fields = [e for e in obs["elements"] if e["tag"] == "input" and re.search(r"card|cvv|expir|email|address|postal|zip", e["name"] + e["placeholder"], re.I)]
        has_pw = any(e["tag"] == "input" and e["type"] == "password" for e in obs["elements"])
        guest = next((e for e in obs["elements"] if re.search(r"guest", e["text"] + e["href"], re.I) and e["tag"] in ("a", "button")), None)
        if guest and has_pw and not any(h["action"].get("tag_guest") for h in hist):
            return {"action": "click", "id": guest["id"], "tag_guest": True}
        if pay_fields and not has_pw and "checkout" in obs["url"].lower():
            return {"action": "extract", "tag": "checkout", "data": {"reached": True, "form_fields": len(pay_fields)}}
        guest = next((e for e in obs["elements"] if re.search(r"guest", e["text"] + e["href"], re.I) and e["tag"] in ("a", "button")), None)
        if guest and not any(h["action"].get("tag_guest") for h in hist):
            return {"action": "click", "id": guest["id"], "tag_guest": True}
        if re.search(r"(log ?in|sign ?in)", obs["text"], re.I) and re.search(r"password", " ".join(e["name"] + e["type"] for e in obs["elements"]), re.I) and self._did(hist, "click"):
            return {"action": "extract", "tag": "checkout", "data": {"reached": False, "blocker": "auth_required"}}
        clicked = sum(1 for h in hist if h["action"].get("action") == "click")
        if clicked >= 3:
            return {"action": "extract", "tag": "checkout", "data": {"reached": False, "blocker": "navigation"}}
        c = next((e for e in obs["elements"] if CHECKOUT.search(e["text"]) and not re.search(r"place order|pay", e["text"], re.I)), None)
        if c: return {"action": "click", "id": c["id"]}
        link = next((e for e in obs["elements"] if e["tag"] == "a" and re.search(r"/cart|/basket", e["href"])), None)
        if link and not self._did(hist, "goto"):
            return {"action": "goto", "url": urljoin(obs["url"], link["href"])}
        return {"action": "extract", "tag": "checkout", "data": {"reached": False, "blocker": "navigation"}}


SHAPES = {
    "product_page": '{"url": page url, "title": product name}  (only when this really is ONE product detail page)',
    "attribute": '{"attribute": name, "value": string or null, "source": "structured"|"text"|"pdf_only"|"absent"}  (pdf_only = the value is only reachable via a linked PDF/document)',
    "price": '{"price": string or null, "currency": string or null, "source": "structured"|"text"|"none", "gated": the exact phrase if price is hidden behind login/quote else null}',
    "inventory": '{"state": e.g. InStock/OutOfStock/"ships in 3 days" or null, "source": "structured"|"text"|"none"}',
    "cart": '{"added": true|false, "reason": short, "quote_only": true|false}  (added=true only if the cart page/mini-cart actually shows the product)',
    "checkout": '{"reached": true|false, "blocker": "captcha"|"auth_required"|"navigation"|null, "form_fields": int}  (reached=true only on a page asking for contact/shipping/payment details)',
    "login": '{"logged_in": true|false, "reason": short}',
    "cart_update": '{"updated": true|false, "before": qty/total before, "after": qty/total after, "reason": short}  (change the quantity to 2 in the cart, apply it, and report what the cart then shows)',
    "shipping": '{"options": [{"label": exact label as shown, "price": exact price text or "free"}], "tax_shown": true|false, "reason": short if none}  (only options visible on the page; do not guess)',
    "payment": '{"outcome": "declined"|"accepted"|"unknown", "excerpt": first 200 chars of the page message}',
}
TAG_FOR = {"discover_product": "product_page", "extract_attribute": "attribute", "get_price": "price", "check_inventory": "inventory",
           "add_to_cart": "cart", "reach_checkout": "checkout", "login": "login", "payment_test": "payment",
           "update_cart": "cart_update", "check_shipping": "shipping"}
FILL_KEYS = ["login_user", "login_password", "email", "first", "last", "name", "address", "city", "postal", "phone", "card", "exp", "cvc"]
TOOL = {"name": "act", "description": "Perform exactly one browser action or report your conclusion with extract.",
        "input_schema": {"type": "object", "properties": {
            "reasoning": {"type": "string", "description": "One or two sentences: what you see and why this action."},
            "action": {"type": "string", "enum": ["goto", "click", "fill", "select", "press", "wait", "extract", "finish"]},
            "option": {"type": "integer", "description": "For select: the option index i from the element's option list."},
            "id": {"type": "integer", "description": "Element id from the list (click/fill)."},
            "url": {"type": "string"}, "key": {"type": "string"},
            "fill_from": {"type": "string", "enum": FILL_KEYS, "description": "For fill: which stored value to type. You never see or choose the value itself."},
            "value": {"type": "string", "description": "For fill of search boxes only: the text to type."},
            "tag": {"type": "string", "enum": list(SHAPES)}, "data": {"type": "object"}},
            "required": ["reasoning", "action"]}}
SYSTEM = """You are the VERTA audit agent, acting like an AI procurement agent shopping on a store. Your job is to measure honestly how well the store works for an agent, not to make it look good.
Rules: use only the listed element ids; one action per turn. Never invent values: report what the page actually shows. If something is not on the page, say so (null / absent). Prefer structured evidence (JSON-LD) over page text. Never enter payment or password data yourself: use fill_from. Products often need a variant (size, colour) chosen with select or click before add-to-cart works: choose the first available option. Never click anything that places an order or pays unless the mission is payment_test. When you have enough to answer the mission, call extract with the exact data shape. Failing honestly is correct; guessing is a defect."""


def compact(obs, n_el=70, n_text=2200):
    els = "\n".join(f'[{e["id"]}] {e["tag"]}{"/" + e["type"] if e["type"] else ""} "{e["text"][:70]}"' + (f' -> {e["href"][:90]}' if e["href"] else "") + (f' name={e["name"]}' if e["name"] else "") + (f' value={e["value"]}' if e.get("value") else "") + (" [checked]" if e.get("selected") and e["type"] in ("radio", "checkbox") else "") + (" [disabled]" if e.get("disabled") else "") + (" options=" + json.dumps(list(enumerate(e["options"]))) if e.get("options") else "") for e in obs["elements"][:n_el])
    ld = []
    for p in obs["product_ld"][:2]:
        offers = p.get("offers"); offers = offers if isinstance(offers, list) else [offers] if offers else []
        ld.append({"name": p.get("name"), "additionalProperty": p.get("additionalProperty"), "offers": [{k: o.get(k) for k in ("price", "priceCurrency", "availability")} for o in offers if isinstance(o, dict)][:3]})
    return f"URL: {obs['url']}\nTitle: {obs['title']}\nProduct JSON-LD: {json.dumps(ld)[:900] if ld else 'none'}\nVisible text:\n{obs['text'][:n_text]}\n\nElements:\n{els}"


class LLMBrain:
    """Claude-driven brain via forced tool use. Same interface as HeuristicBrain.
    Credentials/card values are never sent to the model (fill_from keys are resolved locally)."""

    def __init__(self, model=None, base_url=None, fallback=True, vision=True):
        self.vision = vision
        self.key = os.environ.get("ANTHROPIC_API_KEY")
        if not self.key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self.model = model or os.environ.get("VERTA_MODEL", "claude-sonnet-5-5")
        self.base = (base_url or os.environ.get("ANTHROPIC_BASE_URL") or "https://api.anthropic.com").rstrip("/")
        self.fallback = HeuristicBrain() if fallback else None
        self.name = f"llm:{self.model}"
        self.fell_back = 0

    def _call(self, system, user, shot=None):
        content = user if not shot else [{"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": shot}}, {"type": "text", "text": user}]
        body = json.dumps({"model": self.model, "max_tokens": 700, "system": system, "tools": [TOOL], "tool_choice": {"type": "tool", "name": "act"},
                           "messages": [{"role": "user", "content": content}]}).encode()
        req = urllib.request.Request(self.base + "/v1/messages", body, {"x-api-key": self.key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        r = json.load(urllib.request.urlopen(req, timeout=40))
        return next(b["input"] for b in r["content"] if b.get("type") == "tool_use")

    def next_action(self, mission, obs, hist, shared):
        tag = TAG_FOR[mission["type"]]
        done = "\n".join(f'{i+1}. {json.dumps({k: v for k, v in h["action"].items() if k != "value"})}' for i, h in enumerate(hist[-8:])) or "(none yet)"
        user = (f"MISSION: {mission['objective']}\nInputs: {json.dumps(mission['inputs'])}\nSuccess criteria: {mission['success_criteria']}\n"
                f"Mission type: {mission['type']}. When done, call extract with tag \"{tag}\" and data shaped as: {SHAPES[tag]}\n"
                f"Step {len(hist)+1} of {mission['budget']['max_steps']}.\nActions so far:\n{done}\n\nCURRENT PAGE\n{compact(obs)}")
        try:
            a = self._call(SYSTEM, user, obs.get("shot") if self.vision else None)
            if a.get("action") == "extract":
                a["tag"] = tag if a.get("tag") not in SHAPES else a["tag"]
                a.setdefault("data", {})
            return a
        except Exception as e:
            if not self.fallback: raise
            self.fell_back += 1
            a = self.fallback.next_action(mission, obs, hist, shared)
            a["reasoning"] = f"[LLM unavailable: {str(e)[:80]}; heuristic fallback]"
            return a
