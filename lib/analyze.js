// VERTA READINESS ANALYZER. Pure: takes what the crawler collected (no network here) and returns the report.
// Eight layers from the Verta framework: discoverability, semantic clarity, product infrastructure, inventory, pricing, policies, interaction, transaction readiness.
// Every check has points, evidence (what we actually saw), a plain-language impact and a fix. The weights are a working hypothesis, not an industry standard.
const P = require('./parse');

const LAYERS = [
  { id: 'discover', name: 'Discoverability', weight: 15, q: 'Can intelligent systems find the business and its products?' },
  { id: 'semantic', name: 'Semantic clarity', weight: 15, q: 'Can they correctly understand what each product is?' },
  { id: 'infra', name: 'Product infrastructure', weight: 20, q: 'Is the catalog available as structured data, not just pictures and layout?' },
  { id: 'inventory', name: 'Inventory', weight: 10, q: 'Can they tell whether something is actually available?' },
  { id: 'pricing', name: 'Pricing', weight: 10, q: 'Can they read the price, the currency and the conditions?' },
  { id: 'policies', name: 'Policies', weight: 10, q: 'Can they read shipping, returns and payment rules?' },
  { id: 'interact', name: 'Interaction', weight: 10, q: 'Can they move around the site without a human’s eyes and mouse?' },
  { id: 'transact', name: 'Transaction readiness', weight: 10, q: 'Could an authorized system get from product to purchase?' }
];
const STATES = [
  { min: 80, key: 'ready', label: 'Verta Ready', line: 'Strong machine-operability.' },
  { min: 60, key: 'compatible', label: 'Verta Compatible', line: 'Most foundations exist, but meaningful gaps remain.' },
  { min: 40, key: 'friction', label: 'Verta Friction', line: 'Intelligent systems can work with the business but hit significant barriers.' },
  { min: 0, key: 'blind', label: 'Verta Blind', line: 'Important business information or capabilities are hidden from machines.' }
];
const okRes = r => !!r && r.status >= 200 && r.status < 300;
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const round = n => Math.round(n * 10) / 10;
const short = (s, n = 90) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const pathOf = u => { try { return new URL(u).pathname || '/'; } catch (e) { return '/'; } };

const SNIPPET_PRODUCT = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Retro Runner Sneakers",
  "description": "Handpicked vintage running shoes, size 42, light wear.",
  "sku": "RR-42",
  "gtin13": "0123456789012",
  "brand": { "@type": "Brand", "name": "Ada's Thrift" },
  "image": ["https://example.com/img/rr-42-1.jpg"],
  "offers": {
    "@type": "Offer",
    "url": "https://example.com/products/retro-runner-42",
    "price": "18500.00",
    "priceCurrency": "NGN",
    "availability": "https://schema.org/InStock"
  }
}
</script>`;

function detectPlatform(html, headers) {
  const h = (html || '').slice(0, 400000), hd = headers || {};
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(h) || hd['x-shopid'] || hd['x-shopify-stage']) return 'Shopify';
  if (/wp-content\/plugins\/woocommerce|woocommerce/i.test(h)) return 'WooCommerce';
  if (/bigcommerce\.com|cdn11\.bigcommerce/i.test(h)) return 'BigCommerce';
  if (/Magento_|mage-cache|\/static\/version\d+\//i.test(h)) return 'Adobe Commerce (Magento)';
  if (/wixstatic\.com|wix\.com/i.test(h)) return 'Wix';
  if (/squarespace\.com|static1\.squarespace/i.test(h)) return 'Squarespace';
  if (/prestashop/i.test(h)) return 'PrestaShop';
  if (/salesforce-commerce|demandware/i.test(h)) return 'Salesforce Commerce';
  return 'Custom or unknown';
}

// ---------- the checks ----------
function analyze(input) {
  const host = input.host, notes = [];
  const homeRes = input.home && input.home.res, homeHtml = okRes(homeRes) ? homeRes.body : '';
  const $home = P.load(homeHtml), homeText = P.visibleText($home);
  const platform = detectPlatform(homeHtml, homeRes && homeRes.headers);
  const robotsTxt = okRes(input.robots && input.robots.res) ? input.robots.res.body : null;
  const robots = P.parseRobots(robotsTxt || '');

  // prepare each product page once
  const allPages = (input.products || []).filter(p => okRes(p.res) && /html|xml/i.test((p.res.headers['content-type'] || 'text/html'))).map(p => {
    const $ = P.load(p.res.body), pr = P.products($), text = P.visibleText($);
    const withOffer = pr.items.find(n => n.name && P.offersOf(n).length) || pr.items.find(n => n.name) || pr.items[0] || null;
    return { url: p.res.url || p.url, res: p.res, $, text, prods: pr, p0: withOffer, offers: withOffer ? P.offersOf(withOffer) : [] };
  });
  // product pages that came back as an empty shell (bot block, redirect page, or JavaScript-only app) carry no information; set them aside
  const shellProducts = allPages.filter(p => p.text.length < 200 && !p.p0);
  const pages = allPages.filter(p => !(p.text.length < 200 && !p.p0));
  const nPages = pages.length;
  if (input.redirectedTo) notes.push(`Your address redirected to ${input.redirectedTo}, so that is the site we scanned. If that is not your storefront, scan a direct product link instead.`);
  if (shellProducts.length) notes.push(`${shellProducts.length} product page(s) came back almost empty to the scanner (blocked, or built entirely by JavaScript) and were left out of the product checks.`);
  const confidence = nPages >= 2 ? 'high' : nPages === 1 ? 'medium' : 'low';
  if (!nPages) notes.push('We could not find a product page to test, so the product layers were skipped. Paste a direct product link for a fuller result.');
  else if (nPages === 1) notes.push('Only one product page was tested. Product results are indicative, not conclusive.');

  const L = {}; LAYERS.forEach(l => { L[l.id] = []; });
  const add = (layer, id, title, max, pts, status, evidence, fix, impact, extra) => L[layer].push(Object.assign({ id, layer, title, max, pts: round(clamp(pts, 0, max)), status, evidence, fix: fix || '', impact: impact || '' }, extra || {}));
  const na = (layer, id, title, max, evidence) => add(layer, id, title, max, 0, 'na', evidence, '', '');
  const info = (layer, id, title, evidence, fix, impact) => add(layer, id, title, 0, 0, 'info', evidence, fix, impact);
  const status = (pts, max) => pts >= max * .999 ? 'pass' : pts <= 0 ? 'fail' : 'warn';
  const avg = fn => nPages ? pages.reduce((s, p) => s + fn(p), 0) / nPages : 0;
  const put = (layer, id, title, max, frac, evidence, fix, impact, extra) => add(layer, id, title, max, max * frac, status(max * frac, max), evidence, fix, impact, extra);

  // ===== 1 DISCOVERABILITY =====
  const blocked = homeRes && (homeRes.status === 403 || homeRes.status === 429 || homeRes.status === 503 || (/just a moment|cf-challenge|captcha|attention required|are you a robot|access denied|verify you are human/i.test(homeRes.body || '') && (homeRes.body || '').length < 20000));
  if (!homeRes) {
    add('discover', 'd1', 'Homepage reachable over HTTPS', 10, 0, 'fail', short(input.home && input.home.error || 'The homepage did not load.'), 'Check that the site is online and loads over https.', 'If the site does not answer, no system can read it.');
  } else {
    const https = /^https:/.test(homeRes.url), fast = homeRes.ms;
    const pts = (okRes(homeRes) ? 5 : 0) + (https ? 3 : 0) + (fast <= 3000 ? 2 : fast <= 6000 ? 1 : 0);
    add('discover', 'd1', 'Homepage reachable over HTTPS', 10, pts, status(pts, 10), `HTTP ${homeRes.status}${https ? ', https' : ', not https'}, answered in ${(fast / 1000).toFixed(1)}s${homeRes.redirects.length ? ', ' + homeRes.redirects.length + ' redirect(s)' : ''}.`,
      https ? 'Speed up the first response (caching, a CDN, lighter pages).' : 'Serve the whole site over https and redirect http to https.', 'Slow or insecure pages are skipped or distrusted by automated systems.');
  }
  const shell = !!homeRes && okRes(homeRes) && homeText.length < 300;
  const unreadable = !homeRes || !!blocked || shell;
  put('discover', 'd8', 'Not blocked by a bot challenge', 15, unreadable ? 0 : 1, !homeRes ? 'The homepage did not load.' : blocked ? `The scanner got HTTP ${homeRes.status} or a verification page. If it was stopped, shopping assistants probably are too.` : shell ? `The homepage came back with only ${homeText.length} characters of readable text: a bot challenge, a redirect page, or an app that needs JavaScript. Assistants that do not run scripts see the same empty page.` : 'The homepage served normal content to an automated visitor.',
    'Allow reputable AI and search crawlers through your firewall or bot protection (Cloudflare, etc.) and test with a plain automated request.', 'If a bot challenge stands in front of the site, an assistant sees an error page instead of your products.');
  if (!robotsTxt) {
    const res = input.robots && input.robots.res;
    add('discover', 'd2', 'robots.txt does not block everyone', 20, 16, 'warn', res && res.status === 404 ? 'No robots.txt. Nothing is blocked, but you also give crawlers no sitemap pointer.' : 'robots.txt could not be read.', 'Add a robots.txt that allows crawling and lists your sitemap(s).', 'Without it, systems have to guess where your catalog is.');
  } else {
    const all = P.canFetch(robots, '*', '/');
    put('discover', 'd2', 'robots.txt does not block everyone', 20, all ? 1 : 0, all ? 'robots.txt exists and does not block the whole site.' : 'robots.txt tells every crawler to stay out of the whole site (Disallow: /).', 'Remove “Disallow: /” for User-agent: * (or scope it to private areas like /cart and /account).', 'A blanket block makes the business invisible to compliant search and AI systems.');
  }
  const probePath = pages[0] ? pathOf(pages[0].url) : '/';
  const SEARCH_AGENTS = ['OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'Claude-SearchBot', 'Claude-User', 'Googlebot', 'Bingbot'];
  const blockedAgents = robotsTxt ? SEARCH_AGENTS.filter(a => !P.canFetch(robots, a, probePath) || !P.canFetch(robots, a, '/')) : [];
  put('discover', 'd3', 'Assistant and search crawlers allowed', 25, 1 - blockedAgents.length / SEARCH_AGENTS.length,
    blockedAgents.length ? `robots.txt blocks: ${blockedAgents.join(', ')}.` : `None of ${SEARCH_AGENTS.length} search and assistant crawlers are blocked${robotsTxt ? '' : ' (no robots.txt)'}.`,
    'Allow the crawlers that fetch pages on behalf of shoppers (OAI-SearchBot, ChatGPT-User, PerplexityBot, Claude-SearchBot, Claude-User, Googlebot, Bingbot).', 'Blocked assistants cannot see your products when a customer asks them for a recommendation.');
  const TRAIN = ['GPTBot', 'ClaudeBot', 'Google-Extended', 'CCBot', 'Applebot-Extended'], trainBlocked = robotsTxt ? TRAIN.filter(a => !P.canFetch(robots, a, '/')) : [];
  if (trainBlocked.length) info('discover', 'd3b', 'Training crawlers blocked', `robots.txt blocks: ${trainBlocked.join(', ')}.`, 'No action needed if this is deliberate. Blocking model-training crawlers does not stop shopping assistants.', 'Training bots and shopping assistants are different crawlers. Make sure the second group is still allowed.');
  // sitemap
  const sm = input.sitemap, smUrls = sm && sm.urls ? sm.urls : [], smProd = smUrls.filter(P.looksLikeProductUrl).length, smKids = sm && sm.children ? sm.children.length : 0;
  if (!sm || !sm.found) add('discover', 'd4', 'Sitemap lists the catalog', 20, 0, 'fail', 'No sitemap.xml found (and none listed in robots.txt).', 'Publish a sitemap.xml that includes every product URL and list it in robots.txt.', 'Without a sitemap, a system only finds the products it happens to stumble on.');
  else { const pts = 10 + (smProd > 0 || (smKids > 0 && sm.productSitemap) ? 10 : 0); add('discover', 'd4', 'Sitemap lists the catalog', 20, pts, status(pts, 20), `Sitemap found: ${smUrls.length} URL(s)${smKids ? ', ' + smKids + ' child sitemap(s)' : ''}${smProd ? ', ' + smProd + ' look like products' : ''}${sm.productSitemap ? ', includes a products sitemap' : ''}.`, 'Make sure product URLs are in the sitemap (a dedicated products sitemap is ideal).', 'A complete sitemap is the cheapest way to make the whole catalog findable.'); }
  // canonical
  const homeCanon = $home('link[rel="canonical"]').attr('href'), pageCanon = avg(p => (p.$('link[rel="canonical"]').attr('href') ? 1 : 0));
  const cpts = (homeCanon ? 5 : 0) + (nPages ? 5 * pageCanon : (homeCanon ? 5 : 0));
  add('discover', 'd5', 'Canonical URLs declared', 10, cpts, status(cpts, 10), `${homeCanon ? 'Homepage has a canonical link' : 'Homepage has no canonical link'}${nPages ? `; ${Math.round(pageCanon * nPages)} of ${nPages} product page(s) have one` : ''}.`, 'Add <link rel="canonical"> to every page so each product has one clear address.', 'Duplicates confuse which URL a system should cite or send a customer to.');
  const llms = input.llms && input.llms.res, hasLlms = okRes(llms) && !/^\s*</.test(llms.body || '') && (llms.body || '').length > 20;
  add('discover', 'd6', 'llms.txt guide for AI systems', 5, hasLlms ? 5 : 0, hasLlms ? 'pass' : 'warn', hasLlms ? `llms.txt found (${llms.body.length} characters).` : 'No llms.txt. Optional: there is no firm evidence yet that systems rely on it.', 'Optional: add /llms.txt with a short summary of the business and links to key pages.', 'Cheap to add, but treat it as a bonus, not a fix.');
  const noindex = [homeRes && /noindex/i.test(homeRes.headers['x-robots-tag'] || ''), /noindex/i.test($home('meta[name="robots"]').attr('content') || '')].some(Boolean) || pages.some(p => /noindex/i.test(p.$('meta[name="robots"]').attr('content') || '') || /noindex/i.test(p.res.headers['x-robots-tag'] || ''));
  put('discover', 'd7', 'Pages are allowed into search indexes', 10, noindex ? 0 : 1, noindex ? 'A “noindex” instruction was found on the homepage or a product page.' : 'No noindex instructions found.', 'Remove noindex from pages you want customers (and assistants) to find.', 'Noindex pages are dropped from the indexes that assistants draw on.');

  // ===== 2 SEMANTIC CLARITY =====
  const NOP = 'Could not test: no product page was found.';
  if (!nPages) ['s1:Clear product title and heading:15', 's2:Descriptions in words:20', 's3:Specifications in a structured form:25', 's4:Images have text descriptions:15', 's5:Variants are clear:15', 's6:Breadcrumbs and related products:10'].forEach(x => { const [i, t, m] = x.split(':'); na('semantic', i, t, +m, NOP); });
  else {
    put('semantic', 's1', 'Clear product title and heading', 15, avg(p => { const h1 = p.$('h1'), t = (p.$('title').text() || '').trim().split(/\s+/).filter(Boolean).length, w = (h1.first().text() || '').trim().split(/\s+/).filter(Boolean).length; return ((h1.length === 1 && w >= 2) ? .5 : h1.length >= 1 ? .25 : 0) + (t >= 3 ? .5 : 0); }),
      `Product page heading: “${short(pages[0].$('h1').first().text() || 'none', 60)}”. ${pages[0].$('h1').length} h1 element(s).`, 'Give each product page one descriptive h1 and a title tag that names the product.', 'The heading is the first thing a system uses to decide what a page is about.');
    put('semantic', 's2', 'Descriptions in words', 20, avg(p => { const md = (p.$('meta[name="description"]').attr('content') || '').trim().length, sd = P.str(p.p0 && p.p0.description).length, vd = Math.max(...['[itemprop="description"]', '.product-description', '.product__description', '#tab-description', '.woocommerce-product-details__short-description', '.description'].map(s => p.$(s).first().text().trim().length), 0); return (md >= 50 && md <= 320 ? .5 : md >= 20 ? .25 : 0) + (sd >= 80 || vd >= 200 ? .5 : p.text.length > 1500 ? .2 : 0); }),
      `Meta description: ${(pages[0].$('meta[name="description"]').attr('content') || '').trim().length} characters; schema description: ${P.str(pages[0].p0 && pages[0].p0.description).length} characters.`, 'Write a real product description (what it is, who it is for, key details) and a 50–300 character meta description.', 'Thin text leaves a system guessing what the product is and whether it fits the request.');
    put('semantic', 's3', 'Specifications in a structured form', 25, avg(p => { const tbl = p.$('table').filter((i, e) => p.$(e).find('tr').length >= 3).length, dl = p.$('dl').filter((i, e) => p.$(e).find('dt').length >= 3).length, ap = p.p0 && (P.arr(p.p0.additionalProperty).length || p.p0.weight || p.p0.width || p.p0.height || p.p0.color || p.p0.material || p.p0.size); if (tbl || dl || ap) return 1; return (p.text.match(/\b\d+(\.\d+)?\s?(mm|cm|m|kg|g|lb|oz|in|inch|v|w|kw|a|hz|l|ml|gb|tb|mah)\b/gi) || []).length >= 2 ? .5 : 0; }),
      (() => { const p = pages[0]; const tbl = p.$('table').filter((i, e) => p.$(e).find('tr').length >= 3).length, dl = p.$('dl').filter((i, e) => p.$(e).find('dt').length >= 3).length; return tbl || dl ? `Specs found in a ${tbl ? 'table' : 'definition list'}.` : P.arr(p.p0 && p.p0.additionalProperty).length ? 'Specs found in schema additionalProperty.' : 'No spec table, list or schema properties; units appear only inside running text (if at all).'; })(),
      'Present size, weight, material, compatibility and similar facts in a table or list, and mirror them as schema.org additionalProperty.', 'Comparing and filtering products needs facts in labelled fields, not buried in paragraphs.');
    const altStats = pages.map(p => { const imgs = p.$('img').filter((i, e) => !p.$(e).closest('header,footer,nav').length && !/icon|logo|sprite|pixel/i.test((p.$(e).attr('class') || '') + (p.$(e).attr('src') || ''))); const withAlt = imgs.filter((i, e) => { const a = (p.$(e).attr('alt') || '').trim(); return a.length > 2 && !/\.(jpe?g|png|webp|gif)$/i.test(a); }).length; return { n: imgs.length, a: withAlt }; });
    const tot = altStats.reduce((s, x) => s + x.n, 0), totA = altStats.reduce((s, x) => s + x.a, 0);
    if (!tot) na('semantic', 's4', 'Images have text descriptions', 15, 'No content images found on the tested product page(s).');
    else put('semantic', 's4', 'Images have text descriptions', 15, totA / tot, `${totA} of ${tot} product images have a meaningful alt text.`, 'Add alt text that names the product and its variant to each image.', 'Systems that cannot see images rely on alt text to know what the product looks like.');
    // variants
    const varInfo = pages.map(p => { const sels = p.$('select').filter((i, e) => p.$(e).find('option').length >= 2 && !/country|currency|lang|sort|qty|quantity/i.test((p.$(e).attr('name') || '') + (p.$(e).attr('id') || ''))), radios = p.$('input[type="radio"]').length, schemaV = !!(p.prods.items.some(n => n._variantOf || P.hasType(n, 'ProductGroup')) || (p.p0 && p.p0.isVariantOf)), labelled = sels.filter((i, e) => { const id = p.$(e).attr('id'); return !!(p.$(e).attr('aria-label') || (id && p.$('label[for="' + id + '"]').length) || p.$(e).closest('label').length); }).length; return { has: sels.length + radios > 0 || schemaV, sels: sels.length, labelled, schemaV }; });
    if (!varInfo.some(v => v.has)) na('semantic', 's5', 'Variants are clear', 15, 'No size, colour or other variant choices detected on the tested page(s).');
    else { const lab = varInfo.reduce((s, v) => s + (v.sels ? v.labelled / v.sels : 1), 0) / varInfo.length, sch = varInfo.filter(v => v.schemaV).length / varInfo.length; put('semantic', 's5', 'Variants are clear', 15, lab * .45 + sch * .55, `Variant choices found. Labelled controls: ${Math.round(lab * 100)}%. Variants described in schema: ${sch ? 'yes' : 'no'}.`, 'Label every variant control and describe variants in structured data (ProductGroup with hasVariant, or one Offer per variant).', 'If variants are not described, a system cannot tell which size or colour a price or stock level applies to.'); }
    put('semantic', 's6', 'Breadcrumbs and related products', 10, avg(p => (p.prods.ld.nodes.some(n => P.hasType(n, 'BreadcrumbList')) || p.$('nav[aria-label*="readcrumb" i], .breadcrumb, .breadcrumbs, [class*="readcrumb"]').length ? .5 : 0) + (p.$('[class*="related" i], [id*="related" i]').length || /you may also like|related products|similar products|customers also/i.test(p.text) ? .5 : 0)),
      'Looked for BreadcrumbList schema, breadcrumb navigation and related-product sections.', 'Add breadcrumbs (with BreadcrumbList markup) and link related products.', 'Category paths and related items tell a system how products belong together.');
  }

  // ===== 3 PRODUCT INFRASTRUCTURE =====
  if (!nPages) ['p1:Product structured data present:30', 'p2:Core product fields complete:25', 'p3:Product identifiers (GTIN, MPN, SKU):15', 'p4:Offer details complete:15'].forEach(x => { const [i, t, m] = x.split(':'); na('infra', i, t, +m, NOP); });
  else {
    const withSchema = pages.filter(p => p.p0).length, micro = pages.some(p => p.prods.microdata), parseErrs = pages.reduce((s, p) => s + p.prods.ld.errors, 0);
    put('infra', 'p1', 'Product structured data present', 30, withSchema / nPages, withSchema ? `${withSchema} of ${nPages} product page(s) carry Product data (${micro ? 'microdata' : 'JSON-LD'}).${parseErrs ? ' ' + parseErrs + ' JSON-LD block(s) failed to parse.' : ''}` : `No Product structured data on ${nPages} product page(s)${parseErrs ? ' (' + parseErrs + ' JSON-LD block(s) failed to parse)' : ''}.`,
      'Add schema.org Product markup (JSON-LD) to every product page. Example below.', 'Without structured data a system must read the page like a human, and often gets the name, price or stock wrong.', { code: SNIPPET_PRODUCT });
    const F = ['name', 'image', 'description', 'sku', 'brand', 'offers'];
    put('infra', 'p2', 'Core product fields complete', 25, avg(p => p.p0 ? F.filter(f => P.str(Array.isArray(p.p0[f]) ? p.p0[f][0] : p.p0[f]) || (f === 'offers' && p.offers.length)).length / F.length : 0),
      pages[0].p0 ? `First page has: ${F.filter(f => P.str(Array.isArray(pages[0].p0[f]) ? pages[0].p0[f][0] : pages[0].p0[f]) || (f === 'offers' && pages[0].offers.length)).join(', ') || 'none of the core fields'}; missing: ${F.filter(f => !(P.str(Array.isArray(pages[0].p0[f]) ? pages[0].p0[f][0] : pages[0].p0[f]) || (f === 'offers' && pages[0].offers.length))).join(', ') || 'nothing'}.` : 'No product data to inspect.',
      'Fill name, image, description, sku, brand and offers in the product markup.', 'Missing fields mean a system has to ask a human or skip the product.');
    put('infra', 'p3', 'Product identifiers (GTIN, MPN, SKU)', 15, avg(p => !p.p0 ? 0 : (p.p0.gtin || p.p0.gtin8 || p.p0.gtin12 || p.p0.gtin13 || p.p0.gtin14 || p.p0.mpn) ? 1 : p.p0.sku ? .5 : 0),
      pages[0].p0 ? `Identifiers on first page: ${['gtin', 'gtin8', 'gtin12', 'gtin13', 'gtin14', 'mpn', 'sku'].filter(k => pages[0].p0[k]).join(', ') || 'none'}.` : 'No product data to inspect.', 'Add GTIN (barcode) or MPN (manufacturer part number) to each product. For B2B parts, MPN matters most.', 'Identifiers are how a system recognises the same product across stores and compares prices.');
    put('infra', 'p4', 'Offer details complete', 15, avg(p => { const o = p.offers.find(x => x.price != null || x.lowPrice != null) || p.offers[0]; if (!o) return 0; return ((P.parsePrice(o.price != null ? o.price : o.lowPrice) > 0 ? 1 : 0) + (P.isIsoCurrency(o.priceCurrency) ? 1 : 0) + (P.availabilityKey(o.availability) ? 1 : 0) + (o.url ? 1 : 0)) / 4; }),
      pages[0].offers[0] ? `First page Offer has: ${['price', 'priceCurrency', 'availability', 'url'].filter(k => pages[0].offers[0][k] != null && pages[0].offers[0][k] !== '').join(', ') || 'no usable fields'}.` : 'No Offer markup found.', 'Each Offer needs price, priceCurrency, availability and url.', 'The Offer is the part a system reads to quote a price and check you can sell it.');
  }
  const shop = input.probes && input.probes.shopifyProducts, woo = input.probes && input.probes.wooStore;
  const shopOk = okRes(shop && shop.res) && shop.json && Array.isArray(shop.json.products) && shop.json.products.length, wooOk = okRes(woo && woo.res) && Array.isArray(woo.json) && woo.json.length;
  put('infra', 'p5', 'Catalog available as an open feed or API', 15, shopOk || wooOk ? 1 : smProd > 0 ? .45 : 0, shopOk ? 'Shopify catalog endpoint (/products.json) is public and returns products.' : wooOk ? 'WooCommerce Store API returns products publicly.' : smProd > 0 ? 'No open catalog feed; products are reachable through the sitemap only.' : 'No open catalog feed or API was found.',
    'Expose the catalog as a feed or API (Google Merchant feed, Shopify/Woo public endpoints, or your own JSON API).', 'A feed lets a system read the whole catalog at once instead of crawling page by page.');

  // ===== 4 INVENTORY =====
  if (!nPages) ['i1:Availability stated in the data:50', 'i2:Stated availability matches the page:30'].forEach(x => { const [i, t, m] = x.split(':'); na('inventory', i, t, +m, NOP); });
  else {
    const avKeys = pages.map(p => p.offers.map(o => P.availabilityKey(o.availability)).filter(Boolean));
    put('inventory', 'i1', 'Availability stated in the data', 50, avKeys.filter(a => a.length).length / nPages, avKeys.some(a => a.length) ? `Availability values found: ${[...new Set([].concat(...avKeys))].join(', ')}.` : 'No schema.org availability value on any tested product page.', 'Add "availability": "https://schema.org/InStock" (or OutOfStock, PreOrder…) to every Offer and keep it current.', 'Without it, a system cannot tell whether to recommend the product or a competitor’s.');
    const cmp = pages.map(p => { const k = p.offers.map(o => P.availabilityKey(o.availability)).find(Boolean); if (!k) return null; const out = /out of stock|sold out|currently unavailable|no longer available/i.test(p.text), canBuy = /add to (cart|bag|basket)|buy now/i.test(p.text); if (k === 'InStock' && out && !canBuy) return false; if ((k === 'OutOfStock' || k === 'SoldOut') && canBuy && !out) return false; return true; }).filter(v => v !== null);
    if (!cmp.length) na('inventory', 'i2', 'Stated availability matches the page', 30, 'No stated availability to compare against.');
    else put('inventory', 'i2', 'Stated availability matches the page', 30, cmp.filter(Boolean).length / cmp.length, cmp.every(Boolean) ? 'Stock status in the data agrees with what the page shows.' : 'The data says one thing and the page says another (for example InStock in the markup, “sold out” on screen).', 'Generate the markup from the same stock data that drives the page.', 'A wrong stock signal makes an assistant promise something you cannot deliver, which costs trust.');
  }
  const shopAvail = shopOk && shop.json.products.some(p => (p.variants || []).some(v => typeof v.available === 'boolean')), wooAvail = wooOk && woo.json.some(p => typeof p.is_in_stock === 'boolean' || typeof p.is_purchasable === 'boolean'), schemaQty = pages.some(p => p.offers.some(o => o.inventoryLevel));
  put('inventory', 'i3', 'Stock detail readable per variant', 20, shopAvail || wooAvail || schemaQty ? 1 : 0, shopAvail ? 'Shopify products.json exposes availability per variant.' : wooAvail ? 'WooCommerce Store API exposes stock status.' : schemaQty ? 'inventoryLevel found in structured data.' : 'No machine-readable stock detail beyond the page itself.', 'Expose per-variant availability (and quantity where you are comfortable) through your feed or API.', 'Buyers ask “do you have 40 of these?”. Without stock detail, a system cannot answer.');

  // ===== 5 PRICING =====
  const WALL = /request (a )?quote|log ?in to (see|view) (the )?price|sign ?in to (see|view)|call (us )?for (a )?price|contact (us )?for (a )?pric|price on request|login for pricing|get (a )?quote/i;
  if (!nPages) ['pr1:Price and currency machine-readable:40', 'pr2:Visible price matches the data:25'].forEach(x => { const [i, t, m] = x.split(':'); na('pricing', i, t, +m, NOP); });
  else {
    put('pricing', 'pr1', 'Price and currency machine-readable', 40, avg(p => { const o = p.offers.find(x => x.price != null || x.lowPrice != null); if (!o) return 0; return (P.parsePrice(o.price != null ? o.price : o.lowPrice) > 0 ? .6 : 0) + (P.isIsoCurrency(o.priceCurrency) ? .4 : 0); }),
      (() => { const o = pages[0].offers.find(x => x.price != null || x.lowPrice != null); return o ? `First page: price ${o.price != null ? o.price : o.lowPrice}, currency ${o.priceCurrency || 'missing'}.` : 'No price in the structured data.'; })(), 'Add price (a plain number) and priceCurrency (ISO code like USD or NGN) to every Offer.', 'A price a system cannot read is a price it cannot compare, so you drop out of “cheapest option” requests.');
    const pp = pages.map(p => { const o = p.offers.find(x => x.price != null); const pr = o ? P.parsePrice(o.price) : NaN; return pr > 0 ? P.priceInText(p.text, pr) : null; }).filter(v => v !== null);
    if (!pp.length) na('pricing', 'pr2', 'Visible price matches the data', 25, 'No structured price to compare with the page.');
    else put('pricing', 'pr2', 'Visible price matches the data', 25, pp.filter(Boolean).length / pp.length, pp.every(Boolean) ? 'The structured price appears on the page as well.' : 'The structured price was not found in the visible text (stale markup, different currency, or loaded later by script).', 'Generate markup and visible price from one source of truth.', 'Mismatched prices make systems distrust the whole page.');
  }
  const wallHit = [homeText].concat(pages.map(p => p.text)).some(t => WALL.test(t)), schemaPrice = pages.some(p => p.offers.some(o => P.parsePrice(o.price) > 0));
  add('pricing', 'pr3', 'Price is not hidden behind a quote or login', 25, wallHit ? (schemaPrice ? 12 : 0) : 25, wallHit ? (schemaPrice ? 'warn' : 'fail') : 'pass', wallHit ? 'Phrases like “request a quote” or “login to see price” were found' + (schemaPrice ? ', but some prices are public.' : ' and no public price was found.') : 'No quote or login wall detected.', 'Publish at least a starting price or price range for each product, even if final quotes are custom.', 'A system will not recommend (or compare) a product with no price. It picks the one with a number.');
  const tiers = pages.some(p => p.offers.some(o => o.priceValidUntil || o.priceSpecification || P.hasType(o, 'AggregateOffer')));
  info('pricing', 'pr4', 'Price validity and quantity tiers', tiers ? 'Price validity or tier/range markup found.' : 'No price validity date or quantity-tier markup.', 'Optional for simple shops. For B2B, add priceValidUntil and tiered price specifications.', 'Wholesale buyers and their assistants need to know how price changes with quantity.');

  // ===== 6 POLICIES =====
  const pol = input.policies || [], by = k => pol.find(p => p.kind === k), polText = k => { const p = by(k); return p && okRes(p.res) ? P.visibleText(P.load(p.res.body)) : ''; };
  for (const [k, id, title] of [['shipping', 'po1', 'Shipping policy findable'], ['returns', 'po2', 'Returns policy findable']]) {
    const p = by(k), t = polText(k), link = input.policyLinks && input.policyLinks[k];
    if (!link && k === 'shipping' && polText('returns').length >= 300 && /shipping|delivery/i.test(polText('returns'))) add('policies', id, title, 25, 15, 'warn', 'No separate shipping page, but shipping is covered on the returns page.', 'Give shipping its own page so it is easy to find.', 'A separate, linked page is the easiest thing for an assistant to quote.');
    else if (!link) add('policies', id, title, 25, 0, 'fail', `No link to a ${k} page was found on the pages we read.`, `Publish a ${k} policy page and link it in the footer.`, `If a customer asks “what does shipping cost to Abuja?”, the assistant cannot answer from your site.`);
    else if (!p || !okRes(p.res)) add('policies', id, title, 25, 8, 'warn', `Found a link (${short(link, 60)}) but the page did not load.`, 'Fix the broken policy link.', 'A dead policy link looks like a missing policy.');
    else add('policies', id, title, 25, t.length >= 300 ? 25 : 12, t.length >= 300 ? 'pass' : 'warn', `${short(link, 60)}: ${t.length} characters of text.`, 'Write the policy in full sentences with specifics (see the next check).', 'A one-line policy answers nothing.');
  }
  const allPol = polText('shipping') + ' ' + polText('returns');
  if (allPol.trim().length < 50) na('policies', 'po3', 'Policies give concrete rules', 20, 'No policy text to read.');
  else { const sig = [/\b\d{1,3}\s*(business\s+)?(day|days|hours|weeks?)\b/i, /free shipping|shipping (cost|fee|rate)s?|flat rate|[$₦£€]\s?\d/i, /countr(y|ies)|international|worldwide|nationwide|domestic|ship to|regions?|states/i, /refund|exchange|store credit|restocking|money back/i].map(r => r.test(allPol)); put('policies', 'po3', 'Policies give concrete rules', 20, sig.filter(Boolean).length / 4, `Found: ${['time limits (days)', 'costs', 'regions', 'refund method'].filter((_, i) => sig[i]).join(', ') || 'none of the usual specifics'}.`, 'State time limits, costs, regions and the refund method in plain sentences.', 'Concrete numbers are what an assistant quotes to a customer. Vague text it cannot use.'); }
  const polNodes = [].concat(...pages.map(p => p.prods.ld.nodes), P.jsonLd($home).nodes), polSchema = polNodes.some(n => n.hasMerchantReturnPolicy || n.shippingDetails || P.hasType(n, 'MerchantReturnPolicy') || P.hasType(n, 'OfferShippingDetails') || P.arr(n.offers).some(o => o && (o.hasMerchantReturnPolicy || o.shippingDetails)));
  put('policies', 'po4', 'Policies in structured data', 20, polSchema ? 1 : 0, polSchema ? 'Return or shipping policy markup found.' : 'No MerchantReturnPolicy or OfferShippingDetails markup found.', 'Add hasMerchantReturnPolicy and shippingDetails to your Offers or Organization markup.', 'Structured policies let a system state your return window or shipping time without guessing.');
  const PAY = /visa|mastercard|paypal|apple pay|google pay|shop pay|stripe|paystack|flutterwave|bank transfer|klarna|afterpay|cash on delivery|pay on delivery|credit card|debit card/i, payHit = [homeText, allPol].concat(pages.map(p => p.text)).some(t => PAY.test(t)) || polNodes.some(n => n.paymentAccepted);
  put('policies', 'po5', 'Payment methods stated', 10, payHit ? 1 : 0, payHit ? 'Payment methods are mentioned.' : 'No payment methods mentioned on the pages we read.', 'List accepted payment methods in the footer or checkout information (and paymentAccepted in markup).', 'Assistants check that the customer can actually pay before sending them over.');

  // ===== 7 INTERACTION =====
  const textPages = nPages ? pages : [{ url: homeRes && homeRes.url, text: homeText, $: $home }];
  const spa = /<div id="(root|app|__next)"[^>]*><\/div>|ng-app|data-reactroot/i.test(homeHtml) && homeText.length < 400;
  put('interact', 'in1', 'Content present without running scripts', 30, textPages.reduce((s, p) => s + (p.text.length >= 600 ? 1 : p.text.length >= 200 ? .5 : 0), 0) / textPages.length, `${nPages ? 'Product page' : 'Homepage'} text readable without scripts: ${textPages[0].text.length} characters${spa ? '. The page looks like an empty app shell filled in by JavaScript.' : '.'}`, 'Render product content on the server (or pre-render it) so it is in the HTML that is first delivered.', 'Many automated visitors do not run JavaScript. If the page is an empty shell, they see nothing.');
  const prodAnchors = $home('a[href]').filter((i, e) => { const h = $home(e).attr('href') || ''; return !/^(#|javascript:|mailto:|tel:)/i.test(h) && P.looksLikeProductUrl(h); }).length, pathsFromFeed = (input.products || []).length > 0 && input.productSource && input.productSource !== 'home';
  put('interact', 'in2', 'Product links are real links', 15, prodAnchors >= 5 ? 1 : prodAnchors > 0 ? .5 : 0, `${prodAnchors} product link(s) found in the homepage HTML${pathsFromFeed ? ' (products were found through the ' + input.productSource + ')' : ''}.`, 'Make product cards real <a href> links, not click handlers on a div.', 'Crawlers and assistants follow links. They cannot click a styled box.');
  const ctlStats = textPages.map(p => { const ctl = p.$('button, select, textarea, input:not([type="hidden"]):not([type="submit"]):not([type="button"]), [role="button"]'); let n = 0, ok = 0; ctl.each((i, e) => { const $e = p.$(e); n++; const id = $e.attr('id'); if ($e.attr('aria-label') || $e.attr('aria-labelledby') || $e.attr('title') || ($e.text() || '').trim() || (id && p.$('label[for="' + id + '"]').length) || $e.closest('label').length || ($e.attr('placeholder') || '').trim() || ($e.attr('value') || '').trim()) ok++; }); return { n, ok }; });
  const cn = ctlStats.reduce((s, x) => s + x.n, 0), co = ctlStats.reduce((s, x) => s + x.ok, 0);
  if (!cn) na('interact', 'in3', 'Buttons and fields have names', 20, 'No form controls were found.');
  else put('interact', 'in3', 'Buttons and fields have names', 20, co / cn, `${co} of ${cn} buttons and fields have an accessible name.`, 'Give every button and input a visible label or aria-label (this also helps people using screen readers).', 'A system reading “button” with no name cannot tell which one adds to cart.');
  if (!nPages) na('interact', 'in4', 'Add to cart is findable', 20, NOP);
  else { const ATC = /add to (cart|bag|basket)|buy now|purchase|order now|add to order/i; const res = pages.map(p => { const form = p.$('form[action*="cart"], form.cart, form[action*="add"]').length > 0, btn = p.$('button, input[type="submit"], a').filter((i, e) => ATC.test((p.$(e).text() || '') + ' ' + (p.$(e).attr('value') || '') + ' ' + (p.$(e).attr('aria-label') || ''))).length > 0 || p.$('[name="add-to-cart"]').length > 0; return form && btn ? 1 : btn ? .6 : 0; }); const f = res.reduce((a, b) => a + b, 0) / res.length;
    if (f === 0 && wallHit) add('interact', 'in4', 'Add to cart is findable', 20, 6, 'warn', 'No add-to-cart control; the site appears to work by quote request.', 'Offer a way to start an order or a quote that a system can follow without a phone call.', 'Quote-only flows cannot be completed by an assistant on a customer’s behalf.');
    else put('interact', 'in4', 'Add to cart is findable', 20, f, f === 1 ? 'Product pages have an add-to-cart form and button.' : f > 0 ? 'A button exists, but it is not clearly part of a cart form.' : 'No add-to-cart control found on the tested product pages.', 'Use a standard form with a clearly labelled “Add to cart” button.', 'An assistant needs one obvious, labelled control to move a product toward purchase.'); }
  const loginWall = pages.some(p => /\/(login|signin|sign-in|account\/login|customer\/account\/login)/i.test(p.url) || (p.$('input[type="password"]').length && p.text.length < 800));
  put('interact', 'in5', 'No login wall in front of products', 15, loginWall ? 0 : 1, loginWall ? 'A product page redirected to a login or shows a password field instead of content.' : 'Product pages open without logging in.', 'Show product information, at least price and specs, to visitors who are not logged in.', 'Systems cannot sign in as your customers. Anything behind a login does not exist to them.');

  // ===== 8 TRANSACTION READINESS =====
  const known = platform !== 'Custom or unknown';
  add('transact', 't1', 'Commerce platform identified', 10, known ? 10 : 5, known ? 'pass' : 'warn', known ? `Looks like ${platform}.` : 'No known commerce platform detected: custom stacks need their own agent-facing API.', known ? 'Keep the platform and its commerce apps current.' : 'Plan an API for catalog, cart and checkout that automated systems can call.', 'Known platforms have standard cart and catalog endpoints that integrations build on.');
  const cart = input.probes && input.probes.shopifyCart, wooCart = input.probes && input.probes.wooCart;
  if (platform === 'Shopify') put('transact', 't2', 'Cart is reachable by a program', 25, okRes(cart && cart.res) ? 1 : 0, okRes(cart && cart.res) ? 'Shopify cart endpoint (/cart.js) answers publicly.' : 'The cart endpoint did not answer.', 'Keep the standard cart endpoints enabled and unblocked.', 'A cart that a program can read and change is the first step toward a machine-completed order.');
  else if (platform === 'WooCommerce') put('transact', 't2', 'Cart is reachable by a program', 25, wooCart && wooCart.res && wooCart.res.status >= 200 && wooCart.res.status < 500 ? 1 : 0, wooCart && wooCart.res && wooCart.res.status < 500 ? 'WooCommerce Store API cart endpoint is present.' : 'The WooCommerce Store API cart endpoint did not answer.', 'Enable and keep the WooCommerce Store API reachable.', 'A cart that a program can read and change is the first step toward a machine-completed order.');
  else na('transact', 't2', 'Cart is reachable by a program', 25, 'We can only test cart access automatically on Shopify and WooCommerce. A deep audit covers custom stacks by hand.');
  const CH = [/apple pay/i, /google pay/i, /shop pay/i, /paypal/i, /guest checkout|checkout as (a )?guest|continue as guest/i, /paystack|flutterwave|stripe/i], chHit = CH.filter(r => [homeText].concat(pages.map(p => p.text), pages.map(p => p.$.html())).some(t => r.test(t))).length;
  add('transact', 't3', 'Fast or guest checkout signals', 20, chHit >= 2 ? 20 : chHit === 1 ? 12 : 4, chHit >= 2 ? 'pass' : 'warn', chHit ? `${chHit} checkout signal(s) found (express pay, guest checkout or a payment provider).` : 'No sign of guest or express checkout. We cannot see inside the checkout itself.', 'Offer guest checkout and at least one express payment method.', 'Forced account creation blocks a delegated purchase.');
  const curDeclared = pages.some(p => p.offers.some(o => P.isIsoCurrency(o.priceCurrency)));
  const t4 = (curDeclared ? 8 : 0) + (payHit ? 7 : 0);
  add('transact', 't4', 'Currency and payment methods declared', 15, t4, status(t4, 15), `Currency in data: ${curDeclared ? 'yes' : 'no'}. Payment methods mentioned: ${payHit ? 'yes' : 'no'}.`, 'Declare priceCurrency in markup and state accepted payment methods.', 'A system must know what it will be charged, in what currency, and how.');
  const polScore = scoreOf(L.policies);
  add('transact', 't5', 'Policy basis for a delegated purchase', 15, polScore === null ? 0 : polScore >= 70 ? 15 : polScore >= 40 ? 8 : 0, polScore === null ? 'fail' : polScore >= 70 ? 'pass' : polScore >= 40 ? 'warn' : 'fail', `Policies layer scored ${polScore === null ? 'n/a' : Math.round(polScore)}/100.`, 'Fix the policy findings above first.', 'Before a system buys for someone, it checks returns, shipping and payment terms.');
  const files = (input.probes && input.probes.agentFiles || []).filter(f => okRes(f.res) && !/^\s*</.test(f.res.body || '') && (f.res.body || '').length > 10);
  add('transact', 't6', 'Machine-readable agent or tool manifest', 4, files.length ? 4 : 0, files.length ? 'pass' : 'warn', files.length ? `Found: ${files.map(f => f.path).join(', ')}.` : 'None found at the usual /.well-known/ locations. These standards are still moving, so treat this as an early signal.', 'Watch the emerging agent and tool standards; add a manifest when your platform supports one.', 'Not required today. It is where early adopters will separate from the rest.');

  // ---------- fairness adjustments ----------
  const toNa = (c, why) => { c.status = 'na'; c.pts = 0; c.evidence = why; c.fix = ''; c.impact = ''; delete c.code; };
  const findC = id => [].concat(...LAYERS.map(l => L[l.id])).find(c => c.id === id);
  if (!nPages && shellProducts.length) { const c = findC('in1'); if (c) { c.pts = 0; c.status = 'fail'; c.evidence = `${shellProducts.length} product page(s) returned almost no readable text (${shellProducts.map(p => p.text.length).join(', ')} characters).`; } }
  if (!nPages) {
    const c3 = findC('pr3'); if (c3 && !wallHit) toNa(c3, 'No product page could be read, so there is nothing to check.');
    const i3 = findC('i3'); if (i3 && i3.pts === 0) toNa(i3, 'No product page or feed could be read.');
  }
  if (unreadable) {
    const KEEP = ['d1', 'd2', 'd3', 'd3b', 'd4', 'd6', 'd8', 'in1', 'p5', 't6'];
    for (const l of LAYERS) for (const c of L[l.id]) if (!KEEP.includes(c.id) && c.status !== 'info') toNa(c, 'Not tested: the scanner was given an empty or blocked page, so this could not be checked.');
    notes.unshift('The scanner got an empty or blocked homepage, so most checks could not run. If assistants are served the same page, this business is invisible to them. If only our scanner is blocked, the real result may be better.');
  }

  // ---------- scoring ----------
  function scoreOf(checks) { const scored = checks.filter(c => c.status !== 'na' && c.status !== 'info' && c.max > 0), mx = scored.reduce((s, c) => s + c.max, 0); return mx ? scored.reduce((s, c) => s + c.pts, 0) / mx * 100 : null; }
  const layers = LAYERS.map(l => ({ id: l.id, name: l.name, weight: l.weight, question: l.q, score: (() => { const s = scoreOf(L[l.id]); return s === null ? null : Math.round(s); })(), checks: L[l.id] }));
  const used = layers.filter(l => l.score !== null), wsum = used.reduce((s, l) => s + l.weight, 0);
  const score0 = wsum ? Math.round(used.reduce((s, l) => s + l.score * l.weight, 0) / wsum) : 0;
  const score = unreadable ? Math.min(score0, 39) : score0;
  const state = unreadable ? { key: 'blind', label: 'Verta Blind', line: 'Automated visitors get an empty or blocked page, so assistants most likely cannot read this site either.' } : STATES.find(s => score >= s.min);
  const all = [].concat(...layers.map(l => l.checks)).filter(c => c.status === 'fail' || c.status === 'warn');
  all.forEach(c => { const lost = c.max - c.pts; c.sev = lost >= 18 ? 'P0' : lost >= 8 ? 'P1' : 'P2'; c.lost = round(lost); });
  const top = all.slice().sort((a, b) => b.lost - a.lost).slice(0, 5).map(c => c.id);
  const counts = { P0: all.filter(c => c.sev === 'P0').length, P1: all.filter(c => c.sev === 'P1').length, P2: all.filter(c => c.sev === 'P2').length };
  return {
    meta: { host, url: input.startUrl, scannedAt: input.scannedAt || new Date().toISOString(), platform, confidence: unreadable ? 'low' : confidence, unreadable, productSource: input.productSource || null, pages: pages.map(p => p.url), policyPages: pol.filter(p => okRes(p.res)).map(p => p.res.url), notes, version: '0.1' },
    score, state: { key: state.key, label: state.label, line: state.line }, layers, top, counts
  };
}

module.exports = { analyze, LAYERS, STATES, detectPlatform };
