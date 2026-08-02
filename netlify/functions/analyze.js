const { analyzeImage } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { base64, mediaType, problemBase64, problemMediaType } = JSON.parse(event.body || '{}');
    if (!base64) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing image data' }) };
    }
    const problemImage = problemBase64 ? { base64: problemBase64, mediaType: problemMediaType || 'image/jpeg' } : null;
    const text = await analyzeImage(base64, mediaType || 'image/jpeg', problemImage);
    return { statusCode: 200, body: JSON.stringify({ text }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
