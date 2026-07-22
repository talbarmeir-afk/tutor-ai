const { askFollowup } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { conversation } = JSON.parse(event.body || '{}');
    if (!Array.isArray(conversation)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing conversation' }) };
    }
    const answer = await askFollowup(conversation);
    return { statusCode: 200, body: JSON.stringify({ answer }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
