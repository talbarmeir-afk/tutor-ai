const { checkWatch } = require('../lib/anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { base64, mediaType, priorState } = req.body || {};
    if (!base64) {
      res.status(400).json({ error: 'Missing image data' });
      return;
    }
    const text = await checkWatch(base64, mediaType || 'image/jpeg', priorState || null);
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
