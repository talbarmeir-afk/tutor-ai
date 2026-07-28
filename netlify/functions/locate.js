const { locateToken } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { base64, mediaType, token, line } = JSON.parse(event.body || '{}');
    if (!base64 || !token) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing image or token' }) };
    }
    const text = await locateToken(base64, mediaType || 'image/jpeg', String(token).slice(0, 80), String(line || '').slice(0, 200));
    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
