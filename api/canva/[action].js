const { canvaHandle } = require('../../lib/canva');
module.exports = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const r = await canvaHandle({
    action: req.query.action, method: req.method, query: req.query, body,
    cookie: req.headers.cookie, origin: `${proto}://${req.headers.host}`, password: req.headers['x-app-password'],
  });
  if (r.setCookies.length) res.setHeader('Set-Cookie', r.setCookies);
  res.setHeader('Cache-Control', 'no-store');
  if (r.location) { res.setHeader('Location', r.location); return res.status(r.code).end(); }
  if (r.html) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.status(r.code).send(r.html); }
  res.status(r.code).json(r.json);
};
