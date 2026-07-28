const { locateToken } = require('../lib/anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { base64, mediaType, token, line } = req.body || {};
    if (!base64 || !token) {
      res.status(400).json({ error: 'Missing image or token' });
      return;
    }
    const text = await locateToken(base64, mediaType || 'image/jpeg', String(token).slice(0, 80), String(line || '').slice(0, 200));
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
