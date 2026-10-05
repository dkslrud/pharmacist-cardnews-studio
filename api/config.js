const { handle } = require('../lib/core');
module.exports = async (req, res) => {
  const { code, json } = await handle('config', {}, req.headers['x-app-password']);
  res.status(code).json(json);
};
