const { extractHomeworkProblems } = require('../../lib/anthropic');
const { checkGuestLimit, GUEST_LIMIT_MESSAGE } = require('../../lib/guestLimit');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { images, accessToken } = JSON.parse(event.body || '{}');
    if (!Array.isArray(images) || !images.length || images.some((img) => !img || !img.base64)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing image data' }) };
    }
    const { allowed } = await checkGuestLimit(event.headers, accessToken);
    if (!allowed) {
      return { statusCode: 429, body: JSON.stringify({ error: GUEST_LIMIT_MESSAGE, guestLimitReached: true }) };
    }
    const problems = await extractHomeworkProblems(images);
    return { statusCode: 200, body: JSON.stringify({ problems }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
