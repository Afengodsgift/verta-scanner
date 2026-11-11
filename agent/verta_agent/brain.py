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


class HeuristicBrain:
    name = "heuristic-v0.1"

    def next_action(self, mission, obs, hist, shared):
        t = mission["type"]
        step = len(hist)
        return getattr(self, "_" + t)(mission, obs, hist, shared, step)

    # --- helpers
    def _did(self, hist, kind):
        return any(h["action"].get("action") == kind or h["action"].get("tag") == kind for h in hist)

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

    def _add_to_cart(self, m, obs, hist, shared, step):
        if not self._did(hist, "click"):
            btn = next((e for e in obs["elements"] if ADD.search(e["text"])), None)
            if not btn:
                return {"action": "extract", "tag": "cart", "data": {"added": False, "reason": "no_add_control", "quote_only": bool(GATED.search(obs["text"]))}}
            return {"action": "click", "id": btn["id"]}
        # verify: cart link/page shows product
        if not self._did(hist, "goto"):
            link = next((e for e in obs["elements"] if e["tag"] == "a" and re.search(r"/cart|/basket", e["href"])), None)
            if link: return {"action": "goto", "url": urljoin(obs["url"], link["href"])}
        title = toks(shared.get("product_title", ""))
        in_cart = bool(title & toks(obs["text"])) and not re.search(r"(cart|basket) is (currently )?empty|no items", obs["text"], re.I)
        return {"action": "extract", "tag": "cart", "data": {"added": in_cart, "cart_url": obs["url"]}}

    def _reach_checkout(self, m, obs, hist, shared, step):
        if CAPTCHA.search(obs["text"]):
            return {"action": "extract", "tag": "checkout", "data": {"reached": False, "blocker": "captcha"}}
        pay_fields = [e for e in obs["elements"] if e["tag"] == "input" and re.search(r"card|cvv|expir|email|address|postal|zip", e["name"] + e["placeholder"], re.I)]
        if pay_fields and "checkout" in obs["url"].lower():
            return {"action": "extract", "tag": "checkout", "data": {"reached": True, "form_fields": len(pay_fields)}}
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


class LLMBrain:
    """Claude-driven brain. Same interface. Not exercised in offline tests."""
    name = "llm"

    def __init__(self, model=None):
        self.key = os.environ.get("ANTHROPIC_API_KEY")
        if not self.key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self.model = model or os.environ.get("VERTA_MODEL", "claude-sonnet-4-5")
        self.fallback = HeuristicBrain()

    def next_action(self, mission, obs, hist, shared):
        els = "\n".join(f'[{e["id"]}] {e["tag"]} "{e["text"]}" {e["href"]}' for e in obs["elements"][:80])
        prompt = f"""You are a procurement agent auditing a store. Mission: {mission['objective']}. Inputs: {json.dumps(mission['inputs'])}.
Page: {obs['url']}
Visible text (truncated): {obs['text'][:2500]}
Elements:\n{els}
History: {json.dumps([h['action'] for h in hist][-6:])}
Reply with ONE JSON action: {{"action":"goto|click|fill|press|extract|finish", ...}}.
click/fill use "id". extract needs "tag" (one of product_page|attribute|price|inventory|cart|checkout) and "data" with the same keys a deterministic reader would produce. Never pay, never fill payment fields."""
        body = json.dumps({"model": self.model, "max_tokens": 400, "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", body, {"x-api-key": self.key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
        try:
            r = json.load(urllib.request.urlopen(req, timeout=30))
            txt = r["content"][0]["text"]
            return json.loads(re.search(r"\{.*\}", txt, re.S).group(0))
        except Exception:
            return self.fallback.next_action(mission, obs, hist, shared)
