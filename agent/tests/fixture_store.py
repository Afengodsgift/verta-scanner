"""Local fixture B2B stores. variants: good, pdf (quote-only, spec in PDF), gated (login price, captcha checkout)."""
import threading, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PRODUCT = dict(slug="ss-ball-valve-1in", name="Stainless Steel Ball Valve 1 inch", rating="1000 PSI", price="84.50")


def page(body, title="Store"):
    return f"<!doctype html><html><head><title>{title}</title>{{ld}}</head><body>{body}</body></html>"


class H(BaseHTTPRequestHandler):
    cart = {}

    def log_message(self, *a): pass

    def send(self, html, code=200, ctype="text/html", headers=None):
        b = html.encode() if isinstance(html, str) else html
        self.send_response(code); self.send_header("Content-Type", ctype); self.send_header("Content-Length", str(len(b)))
        for k, v in (headers or {}).items(): self.send_header(k, v)
        self.end_headers(); self.wfile.write(b)

    def do_POST(self):
        v, path = self.route()
        if path == "/cart/add":
            H.cart[v] = PRODUCT["name"]
            self.send("", 303, headers={"Location": f"/{v}/cart"})
        else: self.send("nf", 404)

    def route(self):
        u = urlparse(self.path); parts = u.path.strip("/").split("/", 1)
        return parts[0], "/" + (parts[1] if len(parts) > 1 else "")

    def do_GET(self):
        u = urlparse(self.path); v, path = self.route()
        if v not in ("good", "pdf", "gated"): return self.send("nf", 404)
        P = f"/{v}"
        nav = f'<header><a href="{P}/">Home</a> <a href="{P}/cart">Cart</a></header>'
        if path == "/":
            return self.send(page(nav + f'<form action="{P}/search" method="get"><input type="search" name="q" placeholder="Search products"><button>Search</button></form><h1>Industrial Supply Co</h1>').replace("{ld}", ""))
        if path == "/search":
            q = parse_qs(u.query).get("q", [""])[0].lower()
            hit = any(w in PRODUCT["name"].lower() for w in q.split()) if q else False
            body = nav + f"<h1>Results for {q}</h1>" + (f'<ul><li><a href="{P}/products/{PRODUCT["slug"]}">{PRODUCT["name"]}</a></li><li><a href="{P}/products/other">Other Item</a></li></ul>' if hit else "<p>No results</p>")
            return self.send(page(body).replace("{ld}", ""))
        if path.startswith("/products/"):
            if path.endswith("other"): return self.send(page(nav + "<h1>Other Item</h1>").replace("{ld}", ""))
            ld = ""; extra = ""
            if v == "good":
                ld = '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@type": "Product", "name": PRODUCT["name"],
                    "additionalProperty": [{"@type": "PropertyValue", "name": "Pressure rating", "value": PRODUCT["rating"]}],
                    "offers": {"@type": "Offer", "price": PRODUCT["price"], "priceCurrency": "USD", "availability": "https://schema.org/InStock"}}) + "</script>"
                extra = f'<p>${PRODUCT["price"]}</p><p>In stock</p><form action="{P}/cart/add" method="post"><button>Add to cart</button></form>'
            elif v == "pdf":
                extra = f'<p>Request a quote for pricing.</p><a href="{P}/datasheet.pdf">Download datasheet (PDF)</a><a href="{P}/rfq">Request a quote</a>'
            else:
                extra = f'<table><tr><td>Pressure rating:</td><td>1000 PSI</td></tr></table><p>Log in to see price</p><p>Ships in 3 days</p><form action="{P}/cart/add" method="post"><button>Add to cart</button></form>'
            body = nav + f"<h1>{PRODUCT['name']}</h1>" + extra
            return self.send(page(body, PRODUCT["name"]).replace("{ld}", ld))
        if path == "/cart":
            item = H.cart.get(v)
            body = nav + "<h1>Your cart</h1>" + (f"<p>{item} x1</p><a href='{P}/checkout'>Proceed to checkout</a>" if item else "<p>Your cart is empty</p>")
            return self.send(page(body).replace("{ld}", ""))
        if path == "/checkout":
            if v == "gated":
                return self.send(page(nav + "<h1>Checkout</h1><p>Please verify you are human</p><div class='h-captcha'></div>").replace("{ld}", ""))
            return self.send(page(nav + '<h1>Checkout</h1><input name="email" placeholder="Email"><input name="card_number" placeholder="Card number"><button>Place order</button>').replace("{ld}", ""))
        self.send("nf", 404)


def start():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"
