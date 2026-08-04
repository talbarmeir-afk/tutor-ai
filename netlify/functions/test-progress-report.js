const { computeDigest, renderDigestHtml, sendEmail, subjectLine } = require('../../lib/progressReport');

const SUPABASE_URL = 'https://obmesjsljpbrbaewzsyq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ibWVzanNsanBicmJhZXd6c3lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNjY3MTIsImV4cCI6MjEwMDY0MjcxMn0.0A1Z5_tmWEyVN-BsO8SColQMBr0kTjStBub0Lpgfbjc';

// Lets a signed-in student send themselves a one-off copy of their own
// progress digest right now, instead of waiting for Monday's cron — so
// they can confirm Resend is wired up correctly. Always sends to the
// requester's own verified account email (never a client-supplied
// address), so this can't be used to spam an arbitrary inbox.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  try {
    const { accessToken } = JSON.parse(event.body || '{}');
    if (!accessToken) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sign in first, then try again.' }) };
    }
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Sign in first, then try again.' }) };
    }
    const user = await userRes.json();

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    if (!serviceKey || !resendKey) {
      return { statusCode: 503, body: JSON.stringify({ error: 'Progress reports aren’t configured yet on the server (missing RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY).' }) };
    }
    const fromAddress = process.env.PROGRESS_REPORT_FROM || 'Claruno <onboarding@resend.dev>';
    const baseUrl = process.env.APP_BASE_URL || 'https://claruno.ai';

    const digest = await computeDigest(user.id, serviceKey);
    const html = renderDigestHtml(digest, `${baseUrl}/api/unsubscribe`);
    await sendEmail(user.email, `[Test] ${subjectLine(digest)}`, html, resendKey, fromAddress);
    return { statusCode: 200, body: JSON.stringify({ sent: true, email: user.email }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message || 'Something went wrong sending the test email' }) };
  }
};
