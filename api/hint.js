const { hintFromImage, hintFromProblemText } = require('../lib/anthropic');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../lib/guestLimit');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { base64, mediaType, problemBase64, problemMediaType, problemText, accessToken } = req.body || {};
    // A homework-queue problem can be hinted before any work photo exists
    // yet (problemText alone, no base64) — otherwise an image is required.
    if (!base64 && !problemText) {
      res.status(400).json({ error: 'Missing image data' });
      return;
    }
    const { allowed } = await checkGuestLimit(req.headers, accessToken);
    if (!allowed) {
      res.status(429).json({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true });
      return;
    }
    let hint;
    if (base64) {
      const problemImage = problemBase64 ? { base64: problemBase64, mediaType: problemMediaType || 'image/jpeg' } : null;
      hint = await hintFromImage(base64, mediaType || 'image/jpeg', problemImage, problemText || null);
    } else {
      hint = await hintFromProblemText(problemText);
    }
    res.status(200).json({ hint });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
