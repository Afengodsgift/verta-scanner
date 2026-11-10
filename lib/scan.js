// Orchestrator: collects pages and probes (network, injectable), then hands everything to the pure analyzer.
const P = require('./parse');
const { analyze } = require('./analyze');
const net = require('./net');

const okRes = r => !!r && r.status >= 200 && r.status < 300;

async function scan(input, opts = {}) {
  const f = opts.fetch || net.safeFetch;
  const deadline = Date.now() + (opts.budgetMs || 24000);
  const left = () => deadline - Date.now();
  const get = async (url, o) => { if (left() < 500) return { error: 'Out of time.' }; try { return { res: await f(url, Object.assign({ timeout: Math.min(8000, left()) }, o)) }; } catch (e) { return { error: e.message }; } };
  const getJson = async (url) => { const r = await get(url, { maxBytes: 600000 }); if (r.res && okRes(r.res)) { try { r.json = JSON.parse(r.res.body); } catch (e) {} } return r; };

  const start = net.normalizeUrl(input);
  const home = await get(start.href);
  if (!home.res && !/took too long|Could not connect/.test(home.error || '')) throw new Error(home.error);
  const base = home.res ? new URL(home.res.url) : start, origin = base.origin, host = base.hostname.replace(/^www\./, '');
  const at = p => origin + p;
  const out = { host, startUrl: start.href, scannedAt: new Date().toISOString(), home, probes: {}, products: [], policies: [], policyLinks: {} };

  // user may have pasted a product URL directly
  const pastedProduct = start.pathname.length > 1 && P.looksLikeProductUrl(start.pathname);

  const [robots, llms, shopProducts, wooStore, ...agent] = await Promise.all([
    get(at('/robots.txt'), { maxBytes: 300000 }), get(at('/llms.txt'), { maxBytes: 100000 }),
    getJson(at('/products.json?limit=5')), getJson(at('/wp-json/wc/store/v1/products?per_page=5')),
    ...['/.well-known/ai-plugin.json', '/.well-known/agent.json', '/.well-known/agent-card.json', '/.well-known/mcp.json'].map(p => get(at(p), { maxBytes: 100000 }).then(r => Object.assign(r, { path: p })))
  ]);
  out.robots = robots; out.llms = llms;
  out.probes.shopifyProducts = shopProducts; out.probes.wooStore = wooStore;
  out.probes.agentFiles = agent;

  // sitemap
  const rb = okRes(robots.res) ? P.parseRobots(robots.res.body) : { sitemaps: [] };
  const smUrl = (rb.sitemaps[0] && /^https?:/.test(rb.sitemaps[0])) ? rb.sitemaps[0] : at('/sitemap.xml');
  const sm = await get(smUrl, { maxBytes: 1200000 });
  const smInfo = { found: false, urls: [], children: [], productSitemap: false };
  if (okRes(sm.res) && /<(urlset|sitemapindex)/i.test(sm.res.body)) {
    const ps = P.parseSitemap(sm.res.body); smInfo.found = true; smInfo.urls = ps.urls; smInfo.children = ps.sitemaps;
    const prodChild = ps.sitemaps.find(u => /product/i.test(u)); smInfo.productSitemap = !!prodChild;
    if (prodChild && left() > 3000) { const c = await get(prodChild, { maxBytes: 1200000 }); if (okRes(c.res)) { const cp = P.parseSitemap(c.res.body); smInfo.urls = smInfo.urls.concat(cp.urls); } }
    else if (!ps.urls.length && ps.sitemaps.length && left() > 3000) { const c = await get(ps.sitemaps[0], { maxBytes: 1200000 }); if (okRes(c.res)) smInfo.urls = smInfo.urls.concat(P.parseSitemap(c.res.body).urls); }
  }
  out.sitemap = smInfo;

  // find up to 3 product pages
  const cand = [];
  const push = (u, src) => { try { const x = new URL(u, origin); if (x.hostname.replace(/^www\./, '') === host && !cand.some(c => c.url === x.href)) cand.push({ url: x.href, src }); } catch (e) {} };
  if (pastedProduct) push(start.href, 'pasted link');
  if (okRes(shopProducts.res) && shopProducts.json && Array.isArray(shopProducts.json.products)) shopProducts.json.products.slice(0, 3).forEach(p => push('/products/' + p.handle, 'Shopify catalog'));
  if (okRes(wooStore.res) && Array.isArray(wooStore.json)) wooStore.json.slice(0, 3).forEach(p => p.permalink && push(p.permalink, 'WooCommerce catalog'));
  smInfo.urls.filter(P.looksLikeProductUrl).slice(0, 3).forEach(u => push(u, 'sitemap'));
  const $h = P.load(home.res && okRes(home.res) ? home.res.body : '');
  const links = [];
  $h('a[href]').each((i, e) => { const h = $h(e).attr('href') || ''; if (!/^(#|javascript:|mailto:|tel:)/i.test(h)) links.push({ href: h, text: $h(e).text().replace(/\s+/g, ' ').trim().toLowerCase() }); });
  links.filter(l => P.looksLikeProductUrl(l.href)).slice(0, 6).forEach(l => push(l.href, 'homepage links'));
  out.productSource = cand[0] ? cand[0].src : null;

  const pageResults = await Promise.all(cand.slice(0, 3).map(c => get(c.url, { maxBytes: 1500000 }).then(r => ({ url: c.url, res: r.res, error: r.error }))));
  out.products = pageResults.filter(p => p.res);

  // policy pages
  const find = re => links.find(l => re.test(l.href) || re.test(l.text));
  const ship = find(/shipping|delivery|dispatch/i), ret = find(/return|refund|exchange|warranty/i);
  const polFetch = [];
  if (ship) { out.policyLinks.shipping = new URL(ship.href, origin).href; polFetch.push(['shipping', out.policyLinks.shipping]); }
  if (ret) { out.policyLinks.returns = new URL(ret.href, origin).href; polFetch.push(['returns', out.policyLinks.returns]); }
  out.policies = await Promise.all(polFetch.map(([kind, u]) => get(u, { maxBytes: 800000 }).then(r => ({ kind, res: r.res }))));

  // platform-specific probes
  const html = home.res ? home.res.body : '';
  if (/cdn\.shopify\.com|myshopify\.com/i.test(html)) out.probes.shopifyCart = await get(at('/cart.js'), { maxBytes: 100000 });
  if (/woocommerce/i.test(html)) out.probes.wooCart = await get(at('/wp-json/wc/store/v1/cart'), { maxBytes: 100000 });

  out.home = { res: home.res, error: home.error };
  return analyze(out);
}

module.exports = { scan };
