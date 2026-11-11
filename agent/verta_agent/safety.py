"""Action validator: the brain proposes, this decides. Hard safety boundaries."""
import re
from urllib.parse import urlparse

ALLOWED = {"goto", "click", "fill", "press", "extract", "wait", "finish"}
FORBIDDEN_TEXT = re.compile(
    r"\b(place order|pay now|complete (purchase|order)|buy now|confirm (order|payment)|submit payment|subscribe)\b", re.I)
PAY_FIELDS = re.compile(r"(card|cvv|cvc|cc-|expir|iban|routing)", re.I)
CRED_FIELDS = re.compile(r"password", re.I)
NEVER_FIELDS = re.compile(r"(ssn|social.?security)", re.I)
# Known processor TEST numbers only. A real card number can never be used by the agent.
TEST_PANS = {"4242424242424242", "4000000000000002", "4111111111111111", "5555555555554444", "378282246310005"}


def authorize_payment_test(host, authorized_hosts, auth_ref, pan):
    """All gates must hold or payment-testing stays disabled."""
    if not auth_ref or len(auth_ref.strip()) < 4: return False, "no authorization reference"
    if host not in (authorized_hosts or []): return False, f"{host} is not in the authorized host list"
    if pan not in TEST_PANS: return False, "card is not a known processor test number"
    return True, "ok"


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
    pol = ctx.get("policy") or {}
    if t == "click" and FORBIDDEN_TEXT.search(ctx.get("element_text", "")) and not (pol.get("payment") and ctx.get("mission_type") == "payment_test"):
        raise SafetyStop(f"click on payment-adjacent control: {ctx['element_text'][:60]!r}")
    if t == "fill":
        f = ctx.get("field", "")
        if NEVER_FIELDS.search(f): raise SafetyStop("attempt to fill a forbidden personal-data field")
        if PAY_FIELDS.search(f) and not (pol.get("payment") and ctx.get("mission_type") == "payment_test"):
            raise SafetyStop("attempt to fill a payment field without authorization")
        if CRED_FIELDS.search(f) and not (pol.get("login") and ctx.get("mission_type") == "login"):
            raise SafetyStop("attempt to fill a password field without login authorization")
    return True, "ok"
