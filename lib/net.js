// Safe outbound fetching. The scanner fetches URLs that strangers type in, so it must never be turned into a way to reach private networks (SSRF):
// only http/https on default ports, every hop (including redirects) is resolved and checked, timeouts and size caps everywhere.
// ALLOW_PRIVATE=1 turns the checks off for local tests only. It is never set in production.
const dns = require('dns').promises;
const net = require('net');

const UA = 'VertaScanner/0.1 (+product data check; contact the site owner who requested it)';

function isPrivateV4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some(n => !(n >= 0 && n <= 255))) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (m) return isPrivateV4(m[1]);
    const m2 = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (m2) { const a = parseInt(m2[1], 16), b = parseInt(m2[2], 16); return isPrivateV4([a >> 8, a & 255, b >> 8, b & 255].join('.')); }
    return /^(fc|fd|fe[89ab])/.test(s) || s.startsWith('64:ff9b:') || s.startsWith('2001:db8');
  }
  return true;
}

async function assertPublicHost(hostname) {
  if (process.env.ALLOW_PRIVATE === '1') return;
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h || h === 'localhost' || /\.(local|localhost|internal|lan|home|corp)$/.test(h)) throw new Error('That address is not a public website.');
  if (net.isIP(h)) { if (isPrivateIp(h)) throw new Error('That address is not a public website.'); return; }
  if (!/^[a-z0-9.-]+$/.test(h) || !h.includes('.')) throw new Error('Enter a full website address, like example.com.');
  let addrs;
  try { addrs = await dns.lookup(h, { all: true }); } catch (e) { throw new Error('We could not find that website (DNS lookup failed).'); }
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error('That address is not a public website.');
}

// Turn what a person typed into a clean https URL (or throw a readable error)
function normalizeUrl(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Enter a store address.');
  if (s.length > 300) throw new Error('That address is too long.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u;
  try { u = new URL(s); } catch (e) { throw new Error('That does not look like a website address.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only http and https addresses can be scanned.');
  if (u.username || u.password) throw new Error('Remove the username and password from the address.');
  if (process.env.ALLOW_PRIVATE !== '1' && u.port && u.port !== '80' && u.port !== '443') throw new Error('Only standard web ports are allowed.');
  u.hash = '';
  return u;
}

async function readCapped(res, maxBytes) {
  const type = (res.headers.get('content-type') || '').toLowerCase();
  const textual = !type || /text|json|xml|html|javascript|plain/.test(type);
  if (!textual || !res.body) { try { res.body && res.body.cancel(); } catch (e) {} return { body: '', truncated: false }; }
  const reader = res.body.getReader(), chunks = []; let n = 0, truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) { chunks.push(value.slice(0, value.length - (n - maxBytes))); truncated = true; try { await reader.cancel(); } catch (e) {} break; }
    chunks.push(value);
  }
  return { body: Buffer.concat(chunks.map(c => Buffer.from(c))).toString('utf8'), truncated };
}

// Returns {url, status, headers, body, ms, redirects, truncated} or throws. Never follows a redirect without checking it.
async function safeFetch(url, opts = {}) {
  const { timeout = 8000, maxBytes = 1500000, maxRedirects = 4, headers = {} } = opts;
  let u = typeof url === 'string' ? normalizeUrl(url) : url;
  const redirects = [], t0 = Date.now();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHost(u.hostname);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    let res;
    try {
      res = await fetch(u.href, { redirect: 'manual', signal: ctl.signal, headers: Object.assign({ 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.5', 'accept-language': 'en' }, headers) });
    } catch (e) {
      clearTimeout(timer);
      throw new Error(e.name === 'AbortError' ? 'The site took too long to answer.' : 'Could not connect to the site.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      clearTimeout(timer);
      try { await res.body.cancel(); } catch (e) {}
      const next = new URL(res.headers.get('location'), u);
      if (next.protocol !== 'http:' && next.protocol !== 'https:') throw new Error('The site redirected somewhere we cannot scan.');
      redirects.push(next.href);
      u = next;
      continue;
    }
    let out;
    try { out = await readCapped(res, maxBytes); } finally { clearTimeout(timer); }
    const h = {};
    res.headers.forEach((v, k) => { h[k.toLowerCase()] = v; });
    return { url: u.href, status: res.status, headers: h, body: out.body, truncated: out.truncated, ms: Date.now() - t0, redirects };
  }
  throw new Error('The site redirected too many times.');
}

module.exports = { safeFetch, normalizeUrl, isPrivateIp, assertPublicHost, UA };
