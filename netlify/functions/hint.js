const { hintFromImage } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { base64, mediaType } = JSON.parse(event.body || '{}');
    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing image data' }) };
    }
    const hint = await hintFromImage(base64, mediaType || 'image/jpeg');
    return { statusCode: 200, body: JSON.stringify({ hint }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
