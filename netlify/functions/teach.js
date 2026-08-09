const { teachSubject, teachFollowup } = require('../../lib/anthropic');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { subject, conversation, mode, materialsDigest } = JSON.parse(event.body || '{}');
    if (Array.isArray(conversation) && conversation.length) {
      const lesson = await teachFollowup(conversation);
      return { statusCode: 200, body: JSON.stringify({ lesson }) };
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing subject' }) };
    }
    const digest = typeof materialsDigest === 'string' && materialsDigest.trim() ? materialsDigest.trim().slice(0, 4000) : null;
    const lesson = await teachSubject(subject.trim().slice(0, 200), mode === 'test_prep' ? 'test_prep' : null, digest);
    return { statusCode: 200, body: JSON.stringify({ lesson }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
