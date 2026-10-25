const { dashHandle } = require('../../lib/dashboard');
module.exports = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const r = await dashHandle({
    action: req.query.action, method: req.method, query: req.query, body: body || {},
    password: req.headers['x-app-password'], authorization: req.headers.authorization,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(r.code).json(r.json);
};
