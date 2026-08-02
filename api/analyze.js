const { analyzeImage } = require('../lib/anthropic');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { base64, mediaType, problemBase64, problemMediaType } = req.body || {};
    if (!base64) {
      res.status(400).json({ error: 'Missing image data' });
      return;
    }
    const problemImage = problemBase64 ? { base64: problemBase64, mediaType: problemMediaType || 'image/jpeg' } : null;
    const text = await analyzeImage(base64, mediaType || 'image/jpeg', problemImage);
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
