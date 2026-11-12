"""Local fixture B2B stores. variants: good, pdf (quote-only, spec in PDF), gated (login price, captcha checkout)."""
import threading, json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote_plus

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

    logged = set()
    orders = []
    qty = {}

    def do_POST(self):
        v, path = self.route()
        n = int(self.headers.get("Content-Length") or 0)
        form = {k: x[0] for k, x in parse_qs(self.rfile.read(n).decode()).items()}
        if path == "/login":
            if form.get("password") == "s3cret" and form.get("email") == "buyer@test.dev":
                H.logged.add(v); return self.send("", 303, headers={"Location": f"/{v}/"})
            return self.send(page(f'<h1>Log in</h1><p>Invalid email or password</p><form method="post" action="/{v}/login"><input type="email" name="email"><input type="password" name="password"><button>Log in</button></form>').replace("{ld}", ""))
        if path == "/checkout" and v == "pay":
            H.orders.append(form)
            if form.get("card_number") == "4242424242424242":
                return self.send(page("<h1>Thank you for your order</h1><p>Order number 1001</p>").replace("{ld}", ""))
            return self.send(page("<h1>Checkout</h1><p>Your card was declined.</p>").replace("{ld}", ""))
        if path == "/cart/add" and v == "full":
            if not form.get("size"):
                return self.send(page(f'<h1>{PRODUCT["name"]}</h1><p class="error">Please choose a size</p>' + self.full_form(v)).replace("{ld}", ""))
            H.qty[v] = 1
            return self.send("", 303, headers={"Location": f"/{v}/cart"})
        if path == "/cart/update" and v == "full":
            H.qty[v] = int(form.get("quantity") or 1)
            return self.send("", 303, headers={"Location": f"/{v}/cart"})
        if path == "/cart/add":
            H.cart[v] = PRODUCT["name"]
            self.send("", 303, headers={"Location": f"/{v}/cart"})
        else: self.send("nf", 404)

    def full_form(self, v):
        return (f'<form action="/{v}/cart/add" method="post"><label for="size">Size</label><select id="size" name="size"><option value="">Choose a size</option>'
                '<option value="s">S</option><option value="m">M</option></select><button>Add to cart</button></form>')

    def route(self):
        u = urlparse(self.path); parts = u.path.strip("/").split("/", 1)
        return parts[0], "/" + (parts[1] if len(parts) > 1 else "")

    def do_GET(self):
        u = urlparse(self.path); v, path = self.route()
        if v not in ("good", "pdf", "gated", "pay", "full"): return self.send("nf", 404)
        P = f"/{v}"
        acct = f'<a href="{P}/logout">Log out</a>' if v in H.logged else f'<a href="{P}/login">Log in</a>'
        nav = f'<header><a href="{P}/">Home</a> <a href="{P}/cart">Cart</a> {acct}</header>'
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
            if v in ("good", "pay", "full"):
                ld = '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@type": "Product", "name": PRODUCT["name"],
                    "additionalProperty": [{"@type": "PropertyValue", "name": "Pressure rating", "value": PRODUCT["rating"]}],
                    "offers": {"@type": "Offer", "price": PRODUCT["price"], "priceCurrency": "USD", "availability": "https://schema.org/InStock"}}) + "</script>"
                extra = f'<p>${PRODUCT["price"]}</p><p>In stock</p>' + (self.full_form(v) if v == "full" else f'<form action="{P}/cart/add" method="post"><button>Add to cart</button></form>')
            elif v == "pdf":
                extra = f'<p>Request a quote for pricing.</p><a href="{P}/datasheet.pdf">Download datasheet (PDF)</a><a href="{P}/rfq">Request a quote</a>'
            else:
                extra = f'<table><tr><td>Pressure rating:</td><td>1000 PSI</td></tr></table><p>Log in to see price</p><p>Ships in 3 days</p><form action="{P}/cart/add" method="post"><button>Add to cart</button></form>'
            body = nav + f"<h1>{PRODUCT['name']}</h1>" + extra
            return self.send(page(body, PRODUCT["name"]).replace("{ld}", ld))
        if path == "/cart" and v == "full":
            n = H.qty.get(v)
            body = nav + "<h1>Your cart</h1>" + (f'<p>{PRODUCT["name"]}</p><p>Qty: {n}</p><p>Total: ${n * 84.5:.2f}</p><form action="{P}/cart/update" method="post"><label for="q">Quantity</label><input id="q" type="number" name="quantity" value="{n}"><button>Update cart</button></form><a href="{P}/checkout">Proceed to checkout</a>' if n else "<p>Your cart is empty</p>")
            return self.send(page(body).replace("{ld}", ""))
        if path == "/cart":
            item = H.cart.get(v)
            body = nav + "<h1>Your cart</h1>" + (f"<p>{item} x1</p><a href='{P}/checkout'>Proceed to checkout</a>" if item else "<p>Your cart is empty</p>")
            return self.send(page(body).replace("{ld}", ""))
        if path == "/login":
            return self.send(page(nav + f'<h1>Log in</h1><form method="post" action="{P}/login"><input type="email" name="email" placeholder="Email"><input type="password" name="password" placeholder="Password"><button>Log in</button></form>').replace("{ld}", ""))
        if path == "/checkout" and v == "full":
            if "guest" not in u.query and v not in H.logged:
                return self.send(page(nav + f'<h1>Checkout</h1><p>Log in to continue</p><input type="email" name="login_email" placeholder="Email"><input type="password" name="password" placeholder="Password"><a href="{P}/checkout?guest=1">Continue as guest</a>').replace("{ld}", ""))
            return self.send(page(nav + '<h1>Checkout</h1><p>Standard shipping $5.00</p><p>Express shipping $15.00</p><p>Tax: $7.20</p><input name="email" placeholder="Email"><input name="card_number" placeholder="Card number"><button>Place order</button>').replace("{ld}", ""))
        if path == "/checkout":
            if v == "pay" and v not in H.logged:
                return self.send("", 303, headers={"Location": f"{P}/login"})
            if v == "pay":
                return self.send(page(nav + f'<h1>Checkout</h1><form method="post" action="{P}/checkout"><input name="email" placeholder="Email"><input name="first_name" placeholder="First name"><input name="card_number" placeholder="Card number"><input name="exp" placeholder="MM/YY"><input name="cvc" placeholder="CVC"><button>Place order</button></form>').replace("{ld}", ""))
            if v == "gated":
                return self.send(page(nav + "<h1>Checkout</h1><p>Please verify you are human</p><div class='h-captcha'></div>").replace("{ld}", ""))
            return self.send(page(nav + '<h1>Checkout</h1><input name="email" placeholder="Email"><input name="card_number" placeholder="Card number"><button>Place order</button>').replace("{ld}", ""))
        self.send("nf", 404)


def start():
    srv = ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_address[1]}"
