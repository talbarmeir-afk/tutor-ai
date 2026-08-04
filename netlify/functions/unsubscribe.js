const SUPABASE_URL = 'https://obmesjsljpbrbaewzsyq.supabase.co';

// Public — no login required, since the recipient (a parent/teacher)
// isn't necessarily a Claruno account holder at all, just an email
// address someone added. The unguessable token in the link is what
// scopes this to exactly one recipient row.
exports.handler = async (event) => {
  const token = event.queryStringParameters && event.queryStringParameters.token;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { 'Content-Type': 'text/html' };
  if (!token || !serviceKey) {
    return { statusCode: 400, headers, body: '<p style="font-family:sans-serif;padding:40px;">Invalid unsubscribe link.</p>' };
  }
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/progress_recipients?unsubscribe_token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({ unsubscribed_at: new Date().toISOString() }),
    });
    const updated = await response.json().catch(() => []);
    if (response.ok && updated.length) {
      return { statusCode: 200, headers, body: '<p style="font-family:sans-serif;padding:40px;">You’ve been unsubscribed from Claruno progress reports.</p>' };
    }
    return { statusCode: 404, headers, body: '<p style="font-family:sans-serif;padding:40px;">That unsubscribe link is no longer valid.</p>' };
  } catch (err) {
    return { statusCode: 500, headers, body: '<p style="font-family:sans-serif;padding:40px;">Something went wrong — try again shortly.</p>' };
  }
};
