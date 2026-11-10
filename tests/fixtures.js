// Three fake stores: good (well-built Shopify-like), mid (some schema, gaps), bad (SPA shell, blocks bots, quote-only).
const GOOD_PROD = (n) => `<!doctype html><html><head><title>Retro Runner Sneakers ${n} | Ada's Thrift</title>
<meta name="description" content="Handpicked vintage running shoes, size 42, light wear. Ships worldwide from Lagos with 14-day returns.">
<link rel="canonical" href="http://HOST/products/retro-runner-${n}">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [
  { '@type': 'Product', name: 'Retro Runner Sneakers ' + n, description: 'Handpicked vintage running shoes in size 42 with light wear, cleaned and inspected.', sku: 'RR-' + n, gtin13: '0123456789012', mpn: 'RR' + n, brand: { '@type': 'Brand', name: "Ada's Thrift" }, image: ['http://HOST/i/' + n + '.jpg'], additionalProperty: [{ '@type': 'PropertyValue', name: 'Size', value: '42' }],
    offers: { '@type': 'Offer', url: 'http://HOST/products/retro-runner-' + n, price: '18500.00', priceCurrency: 'NGN', availability: 'https://schema.org/InStock', hasMerchantReturnPolicy: { '@type': 'MerchantReturnPolicy', merchantReturnDays: 14 }, shippingDetails: { '@type': 'OfferShippingDetails' } } },
  { '@type': 'BreadcrumbList', itemListElement: [] }] })}</script></head>
<body><header><nav aria-label="Breadcrumb"><a href="/">Home</a></nav></header><main>
<h1>Retro Runner Sneakers ${n}</h1><p>Handpicked vintage running shoes in size 42 with light wear, cleaned and inspected by our team. ${'Great for daily wear and light running. '.repeat(12)}</p>
<img src="/i/${n}.jpg" alt="Retro Runner Sneakers ${n} side view"><div>₦18500.00</div>
<table><tr><th>Size</th><td>42</td></tr><tr><th>Weight</th><td>600 g</td></tr><tr><th>Material</th><td>Mesh</td></tr></table>
<label for="size">Size</label><select id="size"><option>41</option><option>42</option></select>
<form action="/cart/add" class="cart"><button type="submit">Add to cart</button></form>
<section class="related"><h2>You may also like</h2></section></main>
<footer><a href="/pages/shipping">Shipping</a> <a href="/pages/returns">Returns</a> We accept Visa, Mastercard, Paystack and Apple Pay. Guest checkout available.</footer></body></html>`;
const POLICY = 'Shipping takes 3-7 business days within Nigeria and 10-14 days to other countries. Shipping costs are a flat rate of ₦3000. Returns are accepted within 14 days for a full refund or exchange to the original payment method. '.repeat(2);

function good(host) {
  return (req, res) => {
    const u = req.url.split('?')[0], send = (t, b, c = 200) => { res.writeHead(c, { 'content-type': t, 'x-shopid': '1' }); res.end(b); };
    if (u === '/') return send('text/html', `<html><head><title>Ada's Thrift</title><link rel="canonical" href="http://${host}/"><meta name="description" content="Vintage shoes"><script src="https://cdn.shopify.com/s/x.js"></script></head><body><h1>Ada's Thrift</h1><a href="/products/retro-runner-1">Runner 1</a><a href="/products/retro-runner-2">Runner 2</a><a href="/products/retro-runner-3">Runner 3</a><a href="/products/retro-runner-4">R4</a><a href="/products/retro-runner-5">R5</a>${'Vintage footwear curated in Lagos. '.repeat(30)}<a href="/pages/shipping">Shipping</a><a href="/pages/returns">Returns</a></body></html>`);
    if (u === '/robots.txt') return send('text/plain', `User-agent: *\nDisallow: /cart\nSitemap: http://${host}/sitemap.xml`);
    if (u === '/sitemap.xml') return send('application/xml', `<urlset>${[1, 2, 3].map(n => `<url><loc>http://${host}/products/retro-runner-${n}</loc></url>`).join('')}</urlset>`);
    if (u === '/llms.txt') return send('text/plain', '# Ada\'s Thrift\nVintage shoes from Lagos. Products: /products');
    if (u === '/products.json') return send('application/json', JSON.stringify({ products: [1, 2, 3].map(n => ({ handle: 'retro-runner-' + n, variants: [{ available: true }] })) }));
    if (u === '/cart.js') return send('application/json', '{"items":[]}');
    let m = u.match(/^\/products\/retro-runner-(\d)/); if (m) return send('text/html', GOOD_PROD(m[1]).replace(/HOST/g, host));
    if (u.startsWith('/pages/')) return send('text/html', `<html><body><p>${POLICY}</p></body></html>`);
    send('text/plain', 'nf', 404);
  };
}
function mid(host) {
  return (req, res) => {
    const u = req.url.split('?')[0], send = (t, b, c = 200) => { res.writeHead(c, { 'content-type': t }); res.end(b); };
    if (u === '/') return send('text/html', `<html><head><title>Bolt Supply</title></head><body><h1>Bolt Supply</h1><a href="/product/hex-bolt-m8">Hex bolt</a><a href="/returns">Returns</a>${'Industrial fasteners. '.repeat(40)}</body></html>`);
    if (u === '/robots.txt') return send('text/plain', 'User-agent: GPTBot\nDisallow: /\nUser-agent: PerplexityBot\nDisallow: /\nUser-agent: *\nDisallow: /admin');
    if (u === '/product/hex-bolt-m8') return send('text/html', `<html><head><title>Hex Bolt M8 Steel</title><script type="application/ld+json">{"@type":"Product","name":"Hex Bolt M8","offers":{"@type":"Offer","price":"4.50","priceCurrency":"USD"}}</script></head><body><h1>Hex Bolt M8</h1><p>Steel hex bolt. ${'Zinc plated. '.repeat(20)}</p><span>$4.50</span><button>Add</button><button></button></body></html>`);
    if (u === '/returns') return send('text/html', '<html><body><p>Returns accepted.</p></body></html>');
    send('text/plain', 'nf', 404);
  };
}
function bad(host) {
  return (req, res) => {
    const u = req.url.split('?')[0], send = (t, b, c = 200) => { res.writeHead(c, { 'content-type': t }); res.end(b); };
    if (u === '/') return send('text/html', '<html><head><title>X</title><meta name="robots" content="noindex"></head><body><div id="root"></div><a href="/login">Request a quote</a><script src="/app.js"></script></body></html>');
    if (u === '/robots.txt') return send('text/plain', 'User-agent: *\nDisallow: /');
    send('text/plain', 'nf', 404);
  };
}
function shellStore(host) {
  return (req, res) => { const send = (t, b, c = 200) => { res.writeHead(c, { 'content-type': t }); res.end(b); };
    if (req.url.split('?')[0] === '/robots.txt') return send('text/plain', 'User-agent: *\nAllow: /');
    send('text/html', '<html><body>Click the button below to continue shopping<button>Continue</button></body></html>'); };
}

// WooCommerce store: Yoast-style schema graph, /refund_returns/ and /shipping-policy/ pages that are NOT linked from the footer, wp-sitemap, Store API.
function woo(host, opts = {}) {
  const prod = slug => `<!doctype html><html><head><title>${slug} - Mama Titi Shop</title><meta name="description" content="Handmade ${slug} from Lagos, made to order."><link rel="canonical" href="http://${host}/product/${slug}/">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'Product', name: slug, description: 'Handmade ' + slug + ' from Lagos, made to order in two days.', sku: 'MT-' + slug, image: 'http://' + host + '/i/' + slug + '.jpg', offers: [{ '@type': 'Offer', price: '12000.00', priceCurrency: 'NGN', availability: 'http://schema.org/InStock', url: 'http://' + host + '/product/' + slug + '/' }] }, { '@type': 'BreadcrumbList', itemListElement: [] }] })}</script></head>
<body class="woocommerce single-product"><nav class="woocommerce-breadcrumb"><a href="/">Home</a></nav><h1 class="product_title entry-title">${slug}</h1>
<p class="price"><span class="woocommerce-Price-amount amount"><bdi><span class="woocommerce-Price-currencySymbol">₦</span>12,000.00</bdi></span></p>
<div class="woocommerce-product-details__short-description"><p>Handmade ${slug} from Lagos, made to order in two days. ${'Quality fabric and careful stitching. '.repeat(10)}</p></div>
<form class="cart" action="http://${host}/product/${slug}/" method="post"><button type="submit" name="add-to-cart" value="12" class="single_add_to_cart_button button alt">Add to cart</button></form>
<table class="woocommerce-product-attributes shop_attributes"><tr><th>Weight</th><td>0.4 kg</td></tr><tr><th>Size</th><td>M</td></tr><tr><th>Material</th><td>Cotton</td></tr></table>
<img src="/i/${slug}.jpg" alt="${slug} front view"><div class="related products"><h2>Related products</h2></div></body></html>`;
  return (req, res) => {
    const u = req.url.split('?')[0], send = (t, b, c = 200) => { res.writeHead(c, { 'content-type': t }); res.end(b); };
    if (u === '/') return send('text/html', `<html><head><title>Mama Titi Shop</title><link rel="canonical" href="http://${host}/"><meta name="description" content="Handmade clothes from Lagos"><link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css"></head><body class="home woocommerce-page"><h1>Mama Titi Shop</h1><ul class="products"><li class="product"><a class="woocommerce-LoopProduct-link" href="/product/ankara-dress/">Ankara dress</a></li><li class="product"><a class="woocommerce-LoopProduct-link" href="/product/aso-oke-cap/">Aso oke cap</a></li></ul>${'Handmade clothing made in Lagos. '.repeat(25)}<footer>We accept Paystack and bank transfer.</footer></body></html>`);
    if (u === '/robots.txt') return send('text/plain', 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php');
    if (u === '/wp-sitemap.xml') return send('application/xml', `<sitemapindex><sitemap><loc>http://${host}/wp-sitemap-posts-product-1.xml</loc></sitemap></sitemapindex>`);
    if (u === '/wp-sitemap-posts-product-1.xml') return send('application/xml', `<urlset><url><loc>http://${host}/product/ankara-dress/</loc></url><url><loc>http://${host}/product/aso-oke-cap/</loc></url></urlset>`);
    if (u === '/wp-json/wc/store/v1/products' && !opts.noApi) return send('application/json', JSON.stringify([{ permalink: `http://${host}/product/ankara-dress/`, is_in_stock: true }, { permalink: `http://${host}/product/aso-oke-cap/`, is_in_stock: true }]));
    if (u === '/wp-json/wc/store/v1/cart') return send('application/json', '{"items":[]}');
    const m = u.match(/^\/product\/([\w-]+)\/?$/); if (m) return send('text/html', prod(m[1]));
    if (u === '/refund_returns/') return send('text/html', `<html><head><title>Refund and Returns Policy</title></head><body><h1>Refund and Returns Policy</h1><p>Returns are accepted within 7 days. Refunds go to the original payment method. ${'Items must be unworn. '.repeat(20)}</p></body></html>`);
    if (u === '/shipping-policy/') return send('text/html', `<html><head><title>Shipping Policy</title></head><body><h1>Shipping Policy</h1><p>We ship within Lagos in 2 days for ₦2000 and to other states in 5 business days. ${'Tracking is shared by email. '.repeat(20)}</p></body></html>`);
    send('text/html', '<html><body>nf</body></html>', 404);
  };
}
// Script-built shop: almost no HTML content, few links.
function jsShop(host) {
  return (req, res) => { const send = (t, b, c = 200) => { res.writeHead(c, { 'content-type': t }); res.end(b); };
    const u = req.url.split('?')[0];
    if (u === '/robots.txt') return send('text/plain', 'User-agent: *\nAllow: /');
    if (u === '/') return send('text/html', '<html><head><title>Kemi Crafts</title></head><body><div id="root"></div>' + 'Handmade beads and jewellery shop run from Abuja, shipping everywhere in Nigeria with careful packaging and friendly service for every customer. '.repeat(5) + '<script src="/app.js"></script></body></html>');
    send('text/html', 'nf', 404); };
}
module.exports = { good, mid, bad, shellStore, woo, jsShop };
