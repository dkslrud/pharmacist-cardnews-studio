const { handle } = require('../lib/core');
module.exports = async (req, res) => {
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body;
  const { code, json } = await handle('analyze', body, req.headers['x-app-password']);
  res.status(code).json(json);
};
