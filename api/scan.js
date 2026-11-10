const { scan } = require('../lib/scan');

const hits = new Map(); // in-memory, per warm instance. Good enough to stop casual abuse.
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, arr = (hits.get(ip) || []).filter(t => now - t < win);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 12;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Use POST.' });
  const ip = String((req.headers['x-forwarded-for'] || '').split(',')[0] || req.socket.remoteAddress || '?').trim();
  if (limited(ip)) return res.status(429).json({ error: 'Too many scans from your network. Try again in a few minutes.' });
  let url = '';
  try { url = req.method === 'GET' ? (req.query && req.query.url) : (typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}).url; } catch (e) {}
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
