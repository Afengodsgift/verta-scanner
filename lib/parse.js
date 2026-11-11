// Parsing helpers: JSON-LD / microdata products, robots.txt, sitemaps, prices, visible text. Pure functions, no network.
const cheerio = require('cheerio');

const load = html => cheerio.load(html || '');

// ---------- structured data ----------
function flatten(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => flatten(n, out)); return; }
  out.push(node);
  if (node['@graph']) flatten(node['@graph'], out);
}
// all JSON-LD nodes on a page (@graph flattened) plus how many blocks failed to parse
function jsonLd($) {
  const nodes = []; let blocks = 0, errors = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    blocks++;
    let txt = $(el).contents().text().replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
    if (!txt) { errors++; return; }
    try { flatten(JSON.parse(txt), nodes); }
    catch (e) { try { flatten(JSON.parse(txt.replace(/,(\s*[}\]])/g, '$1')), nodes); } catch (e2) { errors++; } }
  });
  return { nodes, blocks, errors };
}
const typesOf = n => [].concat(n['@type'] || []).map(String);
const hasType = (n, t) => typesOf(n).some(x => x === t || x.endsWith('/' + t));
const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const str = v => (v == null ? '' : typeof v === 'object' ? String(v.name || v['@id'] || v.url || '') : String(v));

// Microdata products (itemtype=schema.org/Product), reduced to the same shape as JSON-LD for the fields we score
function microdataProducts($) {
  const out = [];
  $('[itemscope][itemtype*="schema.org/Product"]').each((_, el) => {
    const $el = $(el), prop = (n, scope) => {
      const e = ($el.find('[itemprop="' + n + '"]').not($el.find('[itemscope] [itemprop]').filter((i, x) => !$(x).closest('[itemscope]').is(el) && n !== 'name'))).first();
      return e.attr('content') || e.attr('href') || e.attr('src') || e.text().trim();
    };
    const offer = { '@type': 'Offer', price: prop('price'), priceCurrency: prop('priceCurrency'), availability: prop('availability'), url: prop('url') };
    out.push({ '@type': 'Product', name: prop('name'), description: prop('description'), image: prop('image'), sku: prop('sku'), gtin13: prop('gtin13') || prop('gtin'), mpn: prop('mpn'), brand: prop('brand'), offers: offer.price || offer.availability ? offer : undefined, _microdata: true });
  });
  return out;
}

// Product-ish nodes on a page. ProductGroup variants are folded in so their offers are visible too.
function products($) {
  const ld = jsonLd($), found = [];
  for (const n of ld.nodes) {
    if (hasType(n, 'Product') || hasType(n, 'ProductGroup')) {
      found.push(n);
      for (const v of arr(n.hasVariant)) if (v && typeof v === 'object') found.push(Object.assign({ _variantOf: n.name }, v));
    }
  }
  const micro = found.length ? [] : microdataProducts($);
  return { items: found.concat(micro), ld, microdata: micro.length > 0 };
}
// every Offer on a product node (offers can be one, many or an AggregateOffer)
// WooCommerce (and others) put price/currency inside priceSpecification instead of on the Offer itself
function liftSpec(o) {
  if (o.price != null && o.price !== '' && o.priceCurrency) return o;
  const spec = arr(o.priceSpecification).find(sp => sp && typeof sp === 'object' && sp.price != null && sp.price !== '');
  if (!spec) return o;
  return Object.assign({}, o, { price: o.price != null && o.price !== '' ? o.price : spec.price, priceCurrency: o.priceCurrency || spec.priceCurrency });
}
function offersOf(p) {
  const out = [];
  for (const o of arr(p && p.offers)) {
    if (!o || typeof o !== 'object') continue;
    if (hasType(o, 'AggregateOffer') && o.offers) out.push(...arr(o.offers).filter(x => x && typeof x === 'object').map(liftSpec), liftSpec(o));
    else out.push(liftSpec(o));
  }
  return out;
}
const AVAIL = ['InStock', 'OutOfStock', 'PreOrder', 'BackOrder', 'SoldOut', 'LimitedAvailability', 'InStoreOnly', 'OnlineOnly', 'Discontinued', 'PreSale', 'MadeToOrder'];
function availabilityKey(v) {
  const s = str(v).trim(); if (!s) return '';
  const k = s.replace(/^https?:\/\/schema\.org\//i, '').replace(/^schema:/i, '');
  return AVAIL.find(a => a.toLowerCase() === k.toLowerCase()) || '';
}
function parsePrice(v) {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /,\d{2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  return parseFloat(s);
}
const isIsoCurrency = v => /^[A-Z]{3}$/.test(str(v).trim());

// ---------- page text ----------
function visibleText($) {
  const c = $.root().clone(); c.find('script,style,noscript,template,svg,iframe').remove();
  return c.find('body').text().replace(/\s+/g, ' ').trim() || c.text().replace(/\s+/g, ' ').trim();
}
// does the visible text contain this price in a common format?
function priceInText(text, price) {
  if (!(price > 0)) return false;
  const whole = Math.round(price) === price, a = price.toFixed(2), b = price.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2 });
  const forms = new Set([a, b, String(price), a.replace('.', ','), b.replace(/,/g, ' '), price.toLocaleString('de-DE', { minimumFractionDigits: whole ? 0 : 2 })]);
  if (whole) { forms.add(String(price)); forms.add(price.toLocaleString('en-US')); }
  for (const f of forms) { const i = text.indexOf(f); if (i >= 0 && !/\d/.test(text[i - 1] || ' ') && !/\d/.test(text[i + f.length] || ' ')) return true; }
  return false;
}

// ---------- robots.txt ----------
function parseRobots(txt) {
  const groups = [], sitemaps = []; let cur = null, lastWasAgent = false;
  for (const raw of String(txt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim(); if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; }
    else if (k === 'allow' || k === 'disallow') { if (cur) cur.rules.push({ type: k, path: v }); lastWasAgent = false; }
    else if (k === 'sitemap') { sitemaps.push(v); lastWasAgent = false; }
    else lastWasAgent = false;
  }
  return { groups, sitemaps };
}
function ruleMatch(path, rule) {
  if (rule === '') return -1;
  const re = new RegExp('^' + rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  return re.test(path) ? rule.length : -1;
}
// can this user agent fetch this path? Most specific matching group wins, longest matching rule wins, Allow beats Disallow on a tie.
function canFetch(robots, ua, path) {
  const u = ua.toLowerCase();
  let grp = robots.groups.filter(g => g.agents.some(a => a !== '*' && u.includes(a)));
  if (!grp.length) grp = robots.groups.filter(g => g.agents.includes('*'));
  if (!grp.length) return true;
  let best = -1, allow = true;
  for (const g of grp) for (const r of g.rules) { const l = ruleMatch(path, r.path); if (l > best || (l === best && r.type === 'allow')) { if (l >= 0) { best = l; allow = r.type === 'allow'; } } }
  return best < 0 ? true : allow;
}

// ---------- sitemaps ----------
function parseSitemap(xml) {
  const urls = [], sitemaps = [];
  const re = /<(url|sitemap)>[\s\S]*?<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>[\s\S]*?<\/\1>/gi; let m;
  while ((m = re.exec(xml || ''))) (m[1].toLowerCase() === 'url' ? urls : sitemaps).push(m[2]);
  return { urls, sitemaps };
}
const PRODUCT_URL = /\/(products?|product-page|product-details|p|item|items|shop|store|catalog|catalogue|sku|dp)\/[^/?#]+/i;
const looksLikeProductUrl = u => PRODUCT_URL.test(String(u)) && !/\/(category|collections?|tag|cart|checkout|account|blog|page|search)\//i.test(String(u));

module.exports = { load, jsonLd, products, offersOf, hasType, typesOf, arr, str, availabilityKey, parsePrice, isIsoCurrency, visibleText, priceInText, parseRobots, canFetch, parseSitemap, looksLikeProductUrl, microdataProducts };
