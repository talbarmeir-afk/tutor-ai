const { askFollowup } = require('../lib/anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { conversation } = req.body || {};
    if (!Array.isArray(conversation)) {
      res.status(400).json({ error: 'Missing conversation' });
      return;
    }
    const answer = await askFollowup(conversation);
    res.status(200).json({ answer });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
