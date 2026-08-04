const { sendAllProgressReports } = require('../../lib/progressReport');

// Triggered weekly by Vercel Cron (see the "crons" entry in vercel.json).
// When CRON_SECRET is set, Vercel automatically sends it as a bearer
// token on cron-triggered requests — checking it here stops this from
// being triggerable by anyone who simply finds the URL, since it emails
// real recipients rather than just reading data.
module.exports = async (req, res) => {
  if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const baseUrl = process.env.APP_BASE_URL || 'https://claruno.ai';
    const result = await sendAllProgressReports(baseUrl);
    res.status(200).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong' });
  }
};
