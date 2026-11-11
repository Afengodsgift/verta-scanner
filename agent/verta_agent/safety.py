"""Action validator: the brain proposes, this decides. Hard safety boundaries."""
import re
from urllib.parse import urlparse

ALLOWED = {"goto", "click", "fill", "press", "extract", "wait", "finish"}
FORBIDDEN_TEXT = re.compile(
    r"\b(place order|pay now|complete (purchase|order)|buy now|confirm (order|payment)|submit payment|subscribe)\b", re.I)
FORBIDDEN_FIELDS = re.compile(r"(card|cvv|cvc|expir|iban|routing|password|ssn)", re.I)


class SafetyStop(Exception):
    pass


def validate(action, ctx):
    """ctx: {'allowed_host': str, 'step': int, 'max_steps': int, 'element_text': str, 'field': str}
    Returns (ok, reason). Raises SafetyStop for payment-adjacent attempts."""
    t = action.get("action")
    if t not in ALLOWED:
        return False, f"action '{t}' not allowed"
    if ctx["step"] >= ctx["max_steps"]:
        return False, "step budget exhausted"
    if t == "goto":
        u = urlparse(action.get("url", ""))
        if u.scheme not in ("http", "https"):
            return False, "non-http url"
        if u.hostname != ctx["allowed_host"]:
            return False, f"off-domain navigation to {u.hostname}"
    if t == "click" and FORBIDDEN_TEXT.search(ctx.get("element_text", "")):
        raise SafetyStop(f"click on payment-adjacent control: {ctx['element_text'][:60]!r}")
    if t == "fill":
        if FORBIDDEN_FIELDS.search(ctx.get("field", "")) or FORBIDDEN_FIELDS.search(action.get("selector", "")):
            raise SafetyStop("attempt to fill a sensitive/payment field")
    return True, "ok"
