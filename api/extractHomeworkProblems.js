const { extractHomeworkProblems } = require('../lib/anthropic');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../lib/guestLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { images, note, accessToken } = req.body || {};
    if (!Array.isArray(images) || !images.length || images.some((img) => !img || !img.base64)) {
      res.status(400).json({ error: 'Missing image data' });
      return;
    }
    const { allowed } = await checkGuestLimit(req.headers, accessToken);
    if (!allowed) {
      res.status(429).json({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true });
      return;
    }
    const problems = await extractHomeworkProblems(images, typeof note === 'string' && note.trim() ? note.trim().slice(0, 300) : null);
    res.status(200).json({ problems });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
