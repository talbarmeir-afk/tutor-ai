const { detectOrientation } = require('../lib/anthropic');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../lib/guestLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { images, accessToken } = req.body || {};
    if (!Array.isArray(images) || images.length !== 4 || images.some((img) => !img || !img.base64)) {
      res.status(400).json({ error: 'Missing image data' });
      return;
    }
    const { allowed } = await checkGuestLimit(req.headers, accessToken);
    if (!allowed) {
      res.status(429).json({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true });
      return;
    }
    const rotation = await detectOrientation(images);
    res.status(200).json({ rotation });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
