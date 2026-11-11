// Local dev: serves public/ and /api/scan. Run: npm run dev, open http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path');
process.env.VERTA_ACCESS_KEY = process.env.VERTA_ACCESS_KEY || 'dev-key';
const api = require('../api/scan');
http.createServer((req, res) => {
  if (req.url.startsWith('/api/scan')) {
    let b = ''; req.on('data', d => b += d); req.on('end', () => { try { req.body = b ? JSON.parse(b) : {}; } catch (e) { req.body = {}; } req.query = {};
      res.status = c => { res.statusCode = c; return res; }; res.json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); }; api(req, res); });
    return;
  }
  let u = req.url.split('?')[0]; if (u.endsWith('/')) u += 'index.html'; else if (!path.extname(u)) u += fs.existsSync(path.join(__dirname, '../public', u + '.html')) ? '.html' : '/index.html';
  const f = path.join(__dirname, '../public', u);
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('nf'); } res.setHeader('content-type', ({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'})[path.extname(f)] || 'text/plain'); res.end(d); });
}).listen(3000, () => console.log('http://localhost:3000'));
