"""Mission loading + validation (Mission Library v0.1 shape)."""
import json

REQUIRED = ["mission_id", "type", "objective", "success_criteria"]
TYPES = {"login", "payment_test", "discover_product", "extract_attribute", "get_price", "check_inventory", "add_to_cart", "reach_checkout"}
DIMENSION = {  # mission type -> scoring dimension
    "login": "authorization_security",
    "payment_test": "transaction",
    "discover_product": "discoverability",
    "extract_attribute": "product_understanding",
    "get_price": "pricing",
    "check_inventory": "inventory",
    "add_to_cart": "transaction",
    "reach_checkout": "transaction",
}


def load(path):
    with open(path) as f:
        m = json.load(f)
    for k in REQUIRED:
        if k not in m:
            raise ValueError(f"mission missing {k}")
    if m["type"] not in TYPES:
        raise ValueError(f"unknown mission type {m['type']}")
    m.setdefault("inputs", {})
    m.setdefault("budget", {"max_steps": 15, "timeout_s": 60})
    m["dimension"] = DIMENSION[m["type"]]
    return m


def default_suite(query, attribute=None, login=False, payment_test=False):
    """The standard 6-mission procurement journey."""
    attr = attribute or "pressure rating"
    base = {"inputs": {"query": query, "attribute": attr}, "budget": {"max_steps": 15, "timeout_s": 60}}
    out = []
    for i, (t, obj, crit) in enumerate([
        ("discover_product", f"Find a product matching '{query}'", ["product page reached"]),
        ("extract_attribute", f"Determine the {attr} of the product", [f"{attr} value found on page"]),
        ("get_price", "Determine the price without logging in", ["price visible"]),
        ("check_inventory", "Determine whether the product is purchasable now", ["availability state found"]),
        ("add_to_cart", "Add the product to cart", ["cart contains product"]),
        ("reach_checkout", "Reach checkout without paying", ["checkout reachable without human-only step"]),
    ], 1):
        out.append({"type": t, "objective": obj, "success_criteria": crit, **json.loads(json.dumps(base))})
    if login:
        out.insert(0, {"type": "login", "objective": "Log in with the merchant-provided test account", "success_criteria": ["authenticated session"], **json.loads(json.dumps(base))})
    if payment_test:
        out.append({"type": "payment_test", "objective": "Submit checkout with a processor TEST card and observe the outcome", "success_criteria": ["payment attempt gets a clear response"], **json.loads(json.dumps(base))})
    for i, m in enumerate(out, 1):
        m["mission_id"] = f"M-{i:04d}"; m["dimension"] = DIMENSION[m["type"]]
    return out
