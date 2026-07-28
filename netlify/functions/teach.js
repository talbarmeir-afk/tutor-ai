const { teachSubject, teachFollowup } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { subject, conversation } = JSON.parse(event.body || '{}');
    if (Array.isArray(conversation) && conversation.length) {
      const lesson = await teachFollowup(conversation);
      return { statusCode: 200, body: JSON.stringify({ lesson }) };
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing subject' }) };
    }
    const lesson = await teachSubject(subject.trim().slice(0, 200));
    return { statusCode: 200, body: JSON.stringify({ lesson }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
