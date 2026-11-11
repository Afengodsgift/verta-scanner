"""Evaluator: judges mission outcome from collected evidence (NOT from the brain's claims)."""


def evaluate(mission, extracts):
    """extracts: list of evidence 'data' dicts tagged. Returns dict(status, failure_code, confidence, summary, root_cause)."""
    t = mission["type"]
    ex = next((e for e in extracts if e["tag"] == {
        "discover_product": "product_page", "extract_attribute": "attribute", "get_price": "price",
        "check_inventory": "inventory", "add_to_cart": "cart", "reach_checkout": "checkout"}[t]), None)
    if ex is None:
        return dict(status="FAILED", failure_code="PRODUCT_NOT_DISCOVERABLE" if t == "discover_product" else "TIMEOUT",
                    confidence="MEDIUM", summary="No conclusive observation was produced.", root_cause=None)
    d = ex["data"]
    R = lambda s, c=None, conf="HIGH", sm="", rc=None: dict(status=s, failure_code=c, confidence=conf, summary=sm, root_cause=rc)
    if t == "discover_product":
        return R("SUCCESS", sm=f"Reached product page: {d.get('title') or d.get('url')}")
    if t == "extract_attribute":
        if d["value"]:
            return R("SUCCESS", conf="HIGH" if d["source"] == "structured" else "MEDIUM", sm=f"{d['attribute']} = {d['value']} (from {d['source']})")
        rc = "Attribute exists only inside a linked PDF." if d["source"] == "pdf_only" else "Attribute not present on page."
        return R("FAILED", "ATTRIBUTE_UNAVAILABLE", sm=f"Could not determine {d['attribute']}.", rc=rc)
    if t == "get_price":
        if d["price"]:
            return R("SUCCESS", conf="HIGH" if d["source"] == "structured" else "MEDIUM", sm=f"Price {d['price']} (from {d['source']})")
        g = (d.get("gated") or "").lower()
        if "log" in g or "sign" in g or "regist" in g or "account" in g:
            return R("FAILED", "PRICE_AUTH_REQUIRED", sm="Price hidden behind login.", rc=f"Page text: '{d['gated']}'")
        return R("FAILED", "PRICE_UNAVAILABLE", sm="No price available.", rc=f"Page text: '{d['gated']}'" if g else "No price on page.")
    if t == "check_inventory":
        if d["state"]:
            return R("SUCCESS", conf="HIGH" if d["source"] == "structured" else "MEDIUM", sm=f"Availability: {d['state']} (from {d['source']})")
        return R("FAILED", "INVENTORY_UNAVAILABLE", sm="No availability signal found.")
    if t == "add_to_cart":
        if d.get("added"):
            return R("SUCCESS", sm="Product present in cart.")
        rc = "Product is quote-only (no add-to-cart)." if d.get("quote_only") else ("No add-to-cart control found." if d.get("reason") == "no_add_control" else "Click did not result in the product appearing in cart.")
        return R("FAILED", "CART_BLOCKED", sm="Could not add product to cart.", rc=rc)
    if t == "reach_checkout":
        if d.get("reached"):
            return R("SUCCESS", sm=f"Checkout reached ({d.get('form_fields')} form fields visible). Stopped before any payment.")
        b = d.get("blocker")
        code = {"captcha": "HUMAN_ONLY_INTERACTION", "auth_required": "AUTH_REQUIRED"}.get(b, "CHECKOUT_BLOCKED")
        return R("FAILED", code, sm="Checkout not reachable.", rc={"captcha": "CAPTCHA/bot challenge.", "auth_required": "Login wall."}.get(b, "No navigable path from cart to checkout."))
