const { hintFromImage, hintFromProblemText } = require('../../lib/anthropic');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../../lib/guestLimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { base64, mediaType, problemBase64, problemMediaType, problemText, accessToken } = JSON.parse(event.body || '{}');
    // A homework-queue problem can be hinted before any work photo exists
    // yet (problemText alone, no base64) — otherwise an image is required.
    if (!base64 && !problemText) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing image data' }) };
    }
    const { allowed } = await checkGuestLimit(event.headers, accessToken);
    if (!allowed) {
      return { statusCode: 429, body: JSON.stringify({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true }) };
    }
    let hint;
    if (base64) {
      const problemImage = problemBase64 ? { base64: problemBase64, mediaType: problemMediaType || 'image/jpeg' } : null;
      hint = await hintFromImage(base64, mediaType || 'image/jpeg', problemImage, problemText || null);
    } else {
      hint = await hintFromProblemText(problemText);
    }
    return { statusCode: 200, body: JSON.stringify({ hint }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
