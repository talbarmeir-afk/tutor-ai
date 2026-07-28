const { teachSubject, teachFollowup } = require('../lib/anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { subject, conversation } = req.body || {};
    if (Array.isArray(conversation) && conversation.length) {
      const lesson = await teachFollowup(conversation);
      res.status(200).json({ lesson });
      return;
    }
    if (!subject || typeof subject !== 'string' || !subject.trim()) {
      res.status(400).json({ error: 'Missing subject' });
      return;
    }
    const lesson = await teachSubject(subject.trim().slice(0, 200));
    res.status(200).json({ lesson });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
