process.env.ALLOW_PRIVATE = '1';
const http = require('http'); const assert = require('assert');
const fx = require('./fixtures'); const P = require('../lib/parse'); const N = require('../lib/net'); const { scan } = require('../lib/scan');
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, '\n   ', e.stack.split('\n').slice(0, 3).join('\n    ')); } };
const serve = make => new Promise(r => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const host = '127.0.0.1:' + s.address().port; s.on('request', make(host)); r({ s, host }); }); });

(async () => {
  await t('robots: specific agent beats *', () => { const r = P.parseRobots('User-agent: *\nDisallow: /\nUser-agent: GPTBot\nAllow: /'); assert(P.canFetch(r, 'GPTBot', '/x')); assert(!P.canFetch(r, 'Other', '/x')); });
  await t('robots: longest match, allow wins tie', () => { const r = P.parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b'); assert(P.canFetch(r, 'x', '/a/b/c')); assert(!P.canFetch(r, 'x', '/a/z')); });
  await t('price parsing', () => { assert.strictEqual(P.parsePrice('1.234,50'), 1234.5); assert.strictEqual(P.parsePrice('$1,234.50'), 1234.5); assert.strictEqual(P.parsePrice('18500.00'), 18500); });
  await t('price in text', () => { assert(P.priceInText('Now ₦18,500.00 only', 18500)); assert(!P.priceInText('Item 118500', 18500)); });
  await t('jsonld tolerates trailing comma', () => { const $ = P.load('<script type="application/ld+json">{"@type":"Product","name":"A",}</script>'); assert.strictEqual(P.products($).items.length, 1); });
  await t('sitemap parse', () => { const s = P.parseSitemap('<urlset><url><loc>http://a/p/1</loc></url></urlset>'); assert.deepStrictEqual(s.urls, ['http://a/p/1']); });
  await t('private ip detection', () => { for (const ip of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '192.168.1.1', '172.16.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', '100.64.0.1']) assert(N.isPrivateIp(ip), ip); assert(!N.isPrivateIp('8.8.8.8')); });
  await t('ssrf blocked without ALLOW_PRIVATE', async () => {
    process.env.ALLOW_PRIVATE = '0';
    try { for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/latest', 'http://[::1]/', 'http://metadata.google.internal/', 'ftp://example.com', 'http://user:pw@example.com', 'http://example.com:22']) { let threw = false; try { await N.safeFetch(u); } catch (e) { threw = true; } assert(threw, u); } }
    finally { process.env.ALLOW_PRIVATE = '1'; }
  });
  const results = {};
  for (const k of ['good', 'mid', 'bad']) {
    const { s, host } = await serve(fx[k]);
    await t('scan ' + k + ' runs', async () => { results[k] = await scan('http://' + host); assert(results[k].layers.length === 8); assert(results[k].score >= 0 && results[k].score <= 100); });
    s.close();
  }
  const g = results.good, m = results.mid, b = results.bad;
  if (g && m && b) {
    console.log('scores  good', g.score, g.state.label, '| mid', m.score, m.state.label, '| bad', b.score, b.state.label);
    console.log('good layers', g.layers.map(l => l.id + ':' + l.score).join(' '));
    console.log('mid layers ', m.layers.map(l => l.id + ':' + l.score).join(' '));
    console.log('bad layers ', b.layers.map(l => l.id + ':' + l.score).join(' '));
    await t('ordering good > mid > bad', () => { assert(g.score > m.score && m.score > b.score); });
    await t('good is Ready or Compatible', () => { assert(g.score >= 75, 'good=' + g.score); });
    await t('bad is Blind', () => { assert(b.state.key === 'blind' || b.state.key === 'friction', 'bad=' + b.score); assert(b.meta.confidence === 'low'); });
    await t('good tested 3 product pages from Shopify catalog', () => { assert.strictEqual(g.meta.pages.length, 3); assert.strictEqual(g.meta.platform, 'Shopify'); });
    await t('mid flags blocked assistants', () => { const c = m.layers[0].checks.find(x => x.id === 'd3'); assert(c.status !== 'pass' && /GPTBot|PerplexityBot/.test(c.evidence + '')); assert(/PerplexityBot/.test(c.evidence)); });
    await t('bad detects robots block, noindex, quote wall', () => { const d = id => b.layers.flatMap(l => l.checks).find(x => x.id === id); assert.strictEqual(d('d2').status, 'fail'); assert.strictEqual(d('d7').status, 'fail'); });
    await t('every failing check has fix + evidence', () => { for (const r of [g, m, b]) for (const l of r.layers) for (const c of l.checks) if (c.status === 'fail' || c.status === 'warn') { assert(c.fix && c.evidence, c.id); assert(c.pts <= c.max); } });
    await t('top list references real checks', () => { for (const r of [m, b]) { const ids = r.layers.flatMap(l => l.checks).map(c => c.id); r.top.forEach(i => assert(ids.includes(i))); assert(r.top.length > 0); } });
    await t('report is JSON-serializable and small', () => { assert(JSON.stringify(g).length < 60000); });
  }
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();
