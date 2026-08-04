// Caps how many checks/hints a signed-out visitor can run per day, so an
// anonymous script can't run up the Anthropic bill. Enforced server-side by
// IP (hashed, never stored raw) against a Supabase table via the service
// role key — the anon key alone can't be used here, since it's public and
// a client could otherwise reset its own count by calling Supabase directly.
// Signed-in users are exempt entirely (verified against Supabase's auth API,
// not just "a token was present", so a fake token can't fake registration).
//
// This is a soft guardrail, not a security wall: if SUPABASE_SERVICE_ROLE_KEY
// isn't configured, or Supabase is unreachable, it fails OPEN (allows the
// request) rather than breaking the core check/hint features for everyone —
// same philosophy as the rest of this app's Supabase integration.

const crypto = require('crypto');

const SUPABASE_URL = 'https://obmesjsljpbrbaewzsyq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ibWVzanNsanBicmJhZXd6c3lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwNjY3MTIsImV4cCI6MjEwMDY0MjcxMn0.0A1Z5_tmWEyVN-BsO8SColQMBr0kTjStBub0Lpgfbjc';
const GUEST_DAILY_LIMIT = 3;

function getClientIp(headers) {
  const forwarded = headers['x-forwarded-for'] || headers['X-Forwarded-For'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return headers['x-real-ip'] || headers['X-Real-Ip'] || 'unknown';
}

async function isSignedIn(accessToken) {
  if (!accessToken) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${accessToken}`, apikey: SUPABASE_ANON_KEY },
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

// Returns { allowed, limitReached } — never throws, so a caller can always
// just check `allowed` without its own try/catch.
async function checkGuestLimit(headers, accessToken) {
  if (await isSignedIn(accessToken)) return { allowed: true };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { allowed: true };

  const ip = getClientIp(headers || {});
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex');

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/try_guest_check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_ip_hash: ipHash, p_limit: GUEST_DAILY_LIMIT }),
    });
    if (!res.ok) return { allowed: true };
    const allowed = await res.json();
    return { allowed: !!allowed, limitReached: !allowed };
  } catch (err) {
    return { allowed: true };
  }
}

const GUEST_LIMIT_MESSAGE = `You've reached your daily limit of ${GUEST_DAILY_LIMIT} checks as a guest. Create a free account to keep going.`;

module.exports = { checkGuestLimit, GUEST_DAILY_LIMIT, GUEST_LIMIT_MESSAGE };
