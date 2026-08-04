const { sendAllProgressReports } = require('../../lib/progressReport');

// Triggered weekly by Netlify Scheduled Functions (see the schedule
// entry in netlify.toml). Scheduled invocations aren't reachable by a
// public URL the normal way, so no extra auth check is needed here the
// way the Vercel cron twin has one.
exports.handler = async () => {
  try {
    const baseUrl = process.env.APP_BASE_URL || 'https://claruno.ai';
    const result = await sendAllProgressReports(baseUrl);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong' }) };
  }
};
