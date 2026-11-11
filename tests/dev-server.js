// Local dev: serves public/ and /api/scan. Run: npm run dev, open http://localhost:3000
const http = require('http'), fs = require('fs'), path = require('path');
const api = require('../api/scan');
http.createServer((req, res) => {
  if (req.url.startsWith('/api/scan')) {
    let b = ''; req.on('data', d => b += d); req.on('end', () => { try { req.body = b ? JSON.parse(b) : {}; } catch (e) { req.body = {}; } req.query = {};
      res.status = c => { res.statusCode = c; return res; }; res.json = o => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); }; api(req, res); });
    return;
  }
  const f = path.join(__dirname, '../public', req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.statusCode = 404; return res.end('nf'); } res.setHeader('content-type', ({'.html':'text/html','.css':'text/css','.js':'text/javascript'})[path.extname(f)] || 'text/plain'); res.end(d); });
}).listen(3000, () => console.log('http://localhost:3000'));
