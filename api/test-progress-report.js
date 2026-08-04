const { computeDigest, renderDigestHtml, sendEmail } = require('../lib/progressReport');

const SUPABASE_URL = 'https://obmesjsljpbrbaewzsyq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ibWVzanNsanBicmJhZXd6c3lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNjY3MTIsImV4cCI6MjEwMDY0MjcxMn0.0A1Z5_tmWEyVN-BsO8SColQMBr0kTjStBub0Lpgfbjc';

// Lets a signed-in student send themselves a one-off copy of their own
// progress digest right now, instead of waiting for Monday's cron — so
// they can confirm Resend is wired up correctly. Always sends to the
// requester's own verified account email (never a client-supplied
// address), so this can't be used to spam an arbitrary inbox.
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { accessToken } = req.body || {};
    if (!accessToken) {
      res.status(401).json({ error: 'Sign in first, then try again.' });
      return;
    }
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
    });
    if (!userRes.ok) {
      res.status(401).json({ error: 'Sign in first, then try again.' });
      return;
    }
    const user = await userRes.json();

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const resendKey = process.env.RESEND_API_KEY;
    if (!serviceKey || !resendKey) {
      res.status(503).json({ error: 'Progress reports aren’t configured yet on the server (missing RESEND_API_KEY or SUPABASE_SERVICE_ROLE_KEY).' });
      return;
    }
    const fromAddress = process.env.PROGRESS_REPORT_FROM || 'Claruno <onboarding@resend.dev>';
    const baseUrl = process.env.APP_BASE_URL || 'https://claruno.ai';

    const digest = await computeDigest(user.id, serviceKey);
    // Not tied to a real recipient row, so there's no real unsubscribe
    // token to use — the link just points at the unsubscribe page itself.
    const html = renderDigestHtml(digest, `${baseUrl}/api/unsubscribe`);
    await sendEmail(user.email, '[Test] Your weekly Claruno progress report', html, resendKey, fromAddress);
    res.status(200).json({ sent: true, email: user.email });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong sending the test email' });
  }
};
