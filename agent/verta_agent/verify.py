"""Claim verification: a brain (especially an LLM) can claim things the page does not show. Before any extract becomes
evidence, check the claim against what the browser actually observed. Rejected claims become honest 'not found' results."""
import json, re

def _norm(s): return re.sub(r"[^a-z0-9.]+", " ", str(s).lower()).strip()

def _haystack(obs):
    return _norm(obs["text"] + " " + json.dumps(obs.get("product_ld") or []))

def _digits(s): return re.sub(r"[^0-9.]", "", str(s)).strip(".")

def check(tag, data, obs, shared=None):
    """Returns (data, notes). notes lists what was rejected/confirmed. Never raises."""
    notes, d, hay = [], dict(data or {}), _haystack(obs)
    t = _norm(obs["text"])
    def reject(msg): notes.append("REJECTED: " + msg)
    if tag == "attribute" and d.get("value"):
        v = _norm(d["value"])
        if v and v not in hay:
            reject(f"claimed value '{d['value']}' for {d.get('attribute')} does not appear on the page"); d["value"], d["source"] = None, "absent"
        else: notes.append("confirmed: attribute value found on page")
    elif tag == "price" and d.get("price"):
        dg = _digits(d["price"])
        if dg and dg not in re.sub(r"[,\s]", "", obs["text"] + json.dumps(obs.get("product_ld") or [])):
            reject(f"claimed price '{d['price']}' not found on the page"); d["price"], d["source"] = None, "none"
        else: notes.append("confirmed: price found on page")
    elif tag == "inventory" and d.get("state"):
        st = _norm(d["state"]).replace("instock", "in stock").replace("outofstock", "out of stock")
        if st and st not in hay.replace("instock", "in stock").replace("outofstock", "out of stock") and st.replace(" ", "") not in hay.replace(" ", ""):
            reject(f"claimed availability '{d['state']}' not found on the page"); d["state"], d["source"] = None, "none"
        else: notes.append("confirmed: availability found on page")
    elif tag == "cart" and d.get("added"):
        title = {w for w in _norm((shared or {}).get("product_title", "")).split() if len(w) > 2}
        on_cart = bool(title & set(t.split())) and not re.search(r"(cart|basket) is (currently )?empty|no items", obs["text"], re.I)
        if title and not on_cart:
            reject("claimed product is in cart but the current page does not show it"); d["added"] = False; d["reason"] = "claim not verified on cart page"
        else: notes.append("confirmed: cart page shows the product")
    elif tag == "checkout" and d.get("reached"):
        fields = [e for e in obs["elements"] if e["tag"] == "input" and e["type"] not in ("hidden", "submit", "checkbox", "radio")]
        pw = any(e["tag"] == "input" and e["type"] == "password" for e in obs["elements"])
        detail = [e for e in fields if re.search(r"card|cvv|expir|address|postal|zip|street|city", e["name"] + e["placeholder"], re.I)]
        if pw and not detail:
            reject("claimed checkout reached but this is a login wall (password field, no shipping or payment fields)"); d["reached"], d["blocker"] = False, "auth_required"
        elif len(fields) < 2 and "checkout" not in obs["url"].lower():
            reject("claimed checkout reached but the page shows no checkout fields"); d["reached"], d["blocker"] = False, "navigation"
        else: notes.append("confirmed: checkout fields visible")
    elif tag == "login" and d.get("logged_in"):
        pw = any(e["tag"] == "input" and e["type"] == "password" for e in obs["elements"])
        if pw or not re.search(r"log ?out|sign ?out|my account|welcome|hello", obs["text"], re.I):
            reject("claimed logged in but a login form is still shown or no account signal present"); d["logged_in"], d["reason"] = False, "claim not verified"
        else: notes.append("confirmed: account signal present, no login form")
    elif tag == "payment":
        o = d.get("outcome")
        dec = bool(re.search(r"declin|payment (failed|error|could not)|invalid (card|number)|your card|insufficient", obs["text"], re.I))
        acc = bool(re.search(r"order (confirmed|received|placed|number)|thank you for your (order|purchase)", obs["text"], re.I))
        actual = "declined" if dec else "accepted" if acc else "unknown"
        if o != actual: reject(f"claimed outcome '{o}' but the page text indicates '{actual}'"); d["outcome"] = actual
        else: notes.append("confirmed: outcome matches page text")
    elif tag == "product_page":
        from .brain import is_product_page
        if not is_product_page(obs): reject("claimed product page but the page shows no product signals"); d["_invalid"] = True
        else: notes.append("confirmed: product signals present")
    elif tag == "shipping":
        good = []
        for o in d.get("options") or []:
            lab, pr = str(o.get("label", "")), str(o.get("price", ""))
            if lab and _norm(lab) in t and (not pr or _digits(pr) in re.sub(r"[,\s]", "", obs["text"]) or pr.lower() in ("free", "$0.00")):
                good.append(o)
            else: reject(f"shipping option '{lab}' not found on the page")
        d["options"], d["verified"] = good, True
    elif tag == "cart_update" and d.get("updated"):
        after = str(d.get("after", ""))
        if after and _norm(after) not in t:
            reject(f"claimed new quantity/total '{after}' not shown in cart"); d["updated"] = False; d["reason"] = "claim not verified"
        else: notes.append("confirmed: cart shows the change")
    return d, notes
