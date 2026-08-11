const { synthesizeSpeech } = require('../lib/tts');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../lib/guestLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { text, accessToken } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'Missing text' });
      return;
    }
    const { allowed } = await checkGuestLimit(req.headers, accessToken);
    if (!allowed) {
      res.status(429).json({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true });
      return;
    }
    const audio = await synthesizeSpeech(text.trim().slice(0, 600));
    res.status(200).json({ audio });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
