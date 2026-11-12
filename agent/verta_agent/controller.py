"""Playwright controller + observer. Observer tags interactive elements with data-verta-id so
the brain refers to elements by id, never by raw selector."""
import json, os, re
from urllib.parse import urlparse

TAG_JS = """
() => {
  const out = []; let n = 0;
  const vis = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  document.querySelectorAll('a[href], button, input, select, textarea, [role=button]').forEach(e => {
    if (!vis(e)) return;
    e.setAttribute('data-verta-id', String(++n));
    out.push({id: n, tag: e.tagName.toLowerCase(), type: e.getAttribute('type') || '',
      text: (e.tagName === 'SELECT' ? '' : (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || (e.labels && e.labels[0] ? e.labels[0].innerText : ''))).trim().slice(0, 100),
      href: e.getAttribute('href') || '', name: e.getAttribute('name') || '', placeholder: e.getAttribute('placeholder') || '',
      options: e.tagName === 'SELECT' ? [...e.options].map(o => o.text.trim().slice(0, 40)).slice(0, 30) : undefined,
      disabled: !!e.disabled, selected: e.tagName === 'SELECT' ? e.selectedIndex : (e.checked ? 1 : 0), value: e.tagName === 'INPUT' ? (e.value || '').slice(0, 30) : ''});
  });
  const ld = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { ld.push(JSON.parse(s.textContent)); } catch (e) {} });
  return {elements: out.slice(0, 250), jsonld: ld, text: document.body ? document.body.innerText.slice(0, 20000) : '', title: document.title};
}
"""


def flatten_ld(ld):
    nodes = []
    def walk(x):
        if isinstance(x, list):
            for i in x: walk(i)
        elif isinstance(x, dict):
            nodes.append(x)
            for v in x.values():
                if isinstance(v, (list, dict)): walk(v)
    walk(ld)
    return nodes


class Controller:
    def __init__(self, headless=True):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self.browser = self._pw.chromium.launch(headless=headless)
        self.ctx = self.browser.new_context(user_agent="VertaAgent/0.1 (+agent-readiness audit)", viewport={"width": 1280, "height": 900})
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(8000)

    def close(self):
        try: self.browser.close()
        finally: self._pw.stop()

    @property
    def url(self): return self.page.url

    def observe(self, vision=False):
        try:
            self.page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception: pass
        d = self.page.evaluate(TAG_JS)
        nodes = flatten_ld(d["jsonld"])
        d["product_ld"] = [n for n in nodes if str(n.get("@type", "")).lower().endswith("product") or (isinstance(n.get("@type"), list) and "Product" in n["@type"])]
        d["url"] = self.page.url
        if vision:
            try:
                import base64
                d["shot_b64"] = base64.b64encode(self.page.screenshot(type="jpeg", quality=55)).decode()
            except Exception:
                d["shot_b64"] = None
        return d

    def screenshot(self, path):
        try:
            self.page.screenshot(path=path, full_page=False)
            return os.path.basename(path)
        except Exception:
            return None

    def execute(self, action):
        """Returns dict(ok, error)."""
        t = action["action"]
        try:
            if t == "goto":
                self.page.goto(action["url"], wait_until="domcontentloaded")
            elif t == "click":
                self.page.locator(f'[data-verta-id="{action["id"]}"]').first.click()
                self.page.wait_for_timeout(600)
            elif t == "fill":
                self.page.locator(f'[data-verta-id="{action["id"]}"]').first.fill(action["value"])
            elif t == "select":
                loc = self.page.locator(f'[data-verta-id="{action["id"]}"]').first
                loc.select_option(index=int(action.get("option", action.get("index", 1))))
                self.page.wait_for_timeout(300)
            elif t == "press":
                self.page.keyboard.press(action["key"])
                self.page.wait_for_timeout(600)
            elif t == "wait":
                self.page.wait_for_timeout(int(action.get("ms", 500)))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e).splitlines()[0][:200]}

    def screenshot_b64(self):
        import base64
        try:
            return base64.b64encode(self.page.screenshot(type="jpeg", quality=55)).decode()
        except Exception:
            return None

    def element(self, obs, eid):
        return next((e for e in obs["elements"] if e["id"] == eid), None)
