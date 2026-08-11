const { synthesizeSpeech } = require('../../lib/tts');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../../lib/guestLimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { text, accessToken } = JSON.parse(event.body || '{}');
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing text' }) };
    }
    const { allowed } = await checkGuestLimit(event.headers, accessToken);
    if (!allowed) {
      return { statusCode: 429, body: JSON.stringify({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true }) };
    }
    const { audio, model } = await synthesizeSpeech(text.trim().slice(0, 600));
    return { statusCode: 200, body: JSON.stringify({ audio, model }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
