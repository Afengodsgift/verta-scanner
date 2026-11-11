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
      text: (e.innerText || e.value || e.getAttribute('aria-label') || e.getAttribute('placeholder') || '').trim().slice(0, 100),
      href: e.getAttribute('href') || '', name: e.getAttribute('name') || '', placeholder: e.getAttribute('placeholder') || ''});
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

    def observe(self):
        try:
            self.page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception: pass
        d = self.page.evaluate(TAG_JS)
        nodes = flatten_ld(d["jsonld"])
        d["product_ld"] = [n for n in nodes if str(n.get("@type", "")).lower().endswith("product") or (isinstance(n.get("@type"), list) and "Product" in n["@type"])]
        d["url"] = self.page.url
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
            elif t == "press":
                self.page.keyboard.press(action["key"])
                self.page.wait_for_timeout(600)
            elif t == "wait":
                self.page.wait_for_timeout(int(action.get("ms", 500)))
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e).splitlines()[0][:200]}

    def element(self, obs, eid):
        return next((e for e in obs["elements"] if e["id"] == eid), None)
