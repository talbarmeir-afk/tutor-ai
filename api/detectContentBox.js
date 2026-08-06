const { detectContentBox } = require('../lib/anthropic');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../lib/guestLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { base64, mediaType, accessToken } = req.body || {};
    if (!base64) {
      res.status(400).json({ error: 'Missing image data' });
      return;
    }
    const { allowed } = await checkGuestLimit(req.headers, accessToken);
    if (!allowed) {
      res.status(429).json({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true });
      return;
    }
    const box = await detectContentBox(base64, mediaType || 'image/jpeg');
    res.status(200).json({ box });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
