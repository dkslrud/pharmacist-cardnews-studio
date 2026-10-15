const { ask } = require('../lib/ask');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 받아요.' });
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { code, json } = await ask(body, req.headers['x-app-password']);
  res.status(code).json(json);
};
