const crypto = require('crypto');
const { scan } = require('../lib/scan');

const hits = new Map(); // in-memory, per warm instance. Good enough to stop casual abuse.
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 12;
}

// Team-only tool: every request needs the access key (env VERTA_ACCESS_KEY). Fails closed when the key is not configured.
const fails = new Map();
function badAuthLimited(ip) {
  const now = Date.now(), arr = (fails.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  arr.push(now); fails.set(ip, arr); if (fails.size > 5000) fails.clear();
  return arr.length > 10;
}
function keyOk(req) {
  const want = process.env.VERTA_ACCESS_KEY || '';
  if (!want) return null; // not configured
  const got = String(req.headers['x-verta-key'] || '');
  const h = v => crypto.createHash('sha256').update(v).digest();
  return crypto.timingSafeEqual(h(got), h(want));
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '?').trim();
  const ok = keyOk(req);
  if (ok === null) return res.status(503).json({ error: 'Access key is not configured on the server.' });
  if (!ok) return badAuthLimited(ip) ? res.status(429).json({ error: 'Too many failed attempts. Try again later.' }) : res.status(401).json({ error: 'Access key required or incorrect.' });
  if (limited(ip)) return res.status(429).json({ error: 'Too many scans from your network. Try again in a few minutes.' });
  let url = '';
  try { url = (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}).url; } catch (e) {}
  if (!url) return res.status(400).json({ error: 'Enter a store address.' });
  try {
    const report = await scan(url);
    res.status(200).json(report);
  } catch (e) {
    const msg = String(e && e.message || 'Scan failed.');
    const friendly = /address|website|http|port|username|redirect|site|DNS|Enter/i.test(msg) ? msg : 'The scan failed unexpectedly. Try again.';
    res.status(422).json({ error: friendly });
  }
};
