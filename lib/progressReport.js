// Computes and emails the weekly progress digest to each account's
// opted-in recipients (parents/teachers). Run by the scheduled functions
// in api/cron/send-progress-reports.js and its Netlify twin — never
// called from the browser. Uses the Supabase service role key throughout
// since this reads across every account's data in one batch job, unlike
// the rest of the app which only ever reads the signed-in user's own rows.

const SUPABASE_URL = 'https://obmesjsljpbrbaewzsyq.supabase.co';

function restHeaders(serviceKey) {
  return { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
}

async function restGet(path, serviceKey) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: restHeaders(serviceKey) });
  if (!res.ok) throw new Error(`Supabase REST GET ${path} failed: ${res.status}`);
  return res.json();
}

// Mirrors mondayOf/weekKey/masteryFor in index.html's Dashboard code —
// keep these in sync if that logic ever changes, since a report that
// disagrees with the Dashboard the parent could also see would be worse
// than not having the report at all.
function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekKey(date) { return mondayOf(date).toISOString().slice(0, 10); }

function masteryFor(stats) {
  if (stats.total < 3) return 'More data needed';
  const ratio = stats.correct / stats.total;
  if (ratio >= 0.85) return 'Mastered';
  if (ratio >= 0.6) return 'Proficient';
  if (ratio >= 0.35) return 'Developing';
  return 'Needs practice';
}

async function computeDigest(userId, serviceKey) {
  const [lessons, entries, profiles] = await Promise.all([
    restGet(`lessons?user_id=eq.${userId}&select=started_at`, serviceKey),
    restGet(`history_entries?user_id=eq.${userId}&select=topic,has_mistake,created_at`, serviceKey),
    restGet(`profiles?user_id=eq.${userId}&select=first_name,weekly_target_lessons`, serviceKey),
  ]);
  const weeklyTarget = (profiles[0] && profiles[0].weekly_target_lessons) || 3;
  const firstName = (profiles[0] && profiles[0].first_name) || '';

  const weekCounts = new Map();
  lessons.forEach((l) => {
    const key = weekKey(new Date(l.started_at));
    weekCounts.set(key, (weekCounts.get(key) || 0) + 1);
  });
  const lessonsThisWeek = weekCounts.get(weekKey(new Date())) || 0;

  let streak = 0;
  const cursor = mondayOf(new Date());
  if ((weekCounts.get(weekKey(cursor)) || 0) < weeklyTarget) cursor.setDate(cursor.getDate() - 7);
  let guard = 0;
  while (guard < 520) {
    guard++;
    const count = weekCounts.get(weekKey(cursor)) || 0;
    if (count < weeklyTarget) break;
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }

  const topicStats = new Map();
  let totalChecks = 0, totalCorrect = 0;
  entries.forEach((e) => {
    const topic = e.topic || 'Other';
    if (!topicStats.has(topic)) topicStats.set(topic, { total: 0, correct: 0 });
    const t = topicStats.get(topic);
    t.total++;
    totalChecks++;
    if (!e.has_mistake) { t.correct++; totalCorrect++; }
  });

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const topicsThisWeek = Array.from(new Set(
    entries.filter((e) => new Date(e.created_at).getTime() >= sevenDaysAgo).map((e) => e.topic || 'Other')
  ));

  return {
    firstName,
    weeklyTarget,
    lessonsThisWeek,
    streak,
    totalChecks,
    accuracy: totalChecks ? Math.round((totalCorrect / totalChecks) * 100) : null,
    topicsThisWeek,
    topics: Array.from(topicStats.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([topic, stats]) => ({ topic, mastery: masteryFor(stats), checks: stats.total })),
  };
}

// Named after the student throughout (subject, heading, opening line) —
// this goes to a parent/teacher, so "your student" read as generic and
// impersonal whenever a first name was actually on file. Falls back to
// generic phrasing only when the profile has no name set.
function subjectLine(digest) {
  return digest.firstName ? `${digest.firstName}'s weekly Claruno progress report` : 'Your weekly Claruno progress report';
}

// Deliberately stats-only, no photos of the student's work — see the
// README for why (a recurring digest to third-party inboxes is a bigger
// privacy step than an in-app check, so it stays to the same numbers
// already visible on the Dashboard).
function renderDigestHtml(digest, unsubscribeUrl) {
  const hasName = !!digest.firstName;
  const name = hasName ? digest.firstName : 'your student';
  const heading = hasName ? `${digest.firstName}’s weekly progress` : 'Weekly progress';
  const topicsRows = digest.topics.length
    ? digest.topics.map((t) => `<tr><td style="padding:4px 12px 4px 0;">${t.topic}</td><td style="padding:4px 0;color:#555;">${t.mastery} (${t.checks} check${t.checks === 1 ? '' : 's'})</td></tr>`).join('')
    : '<tr><td style="padding:4px 0;color:#555;">No checks yet.</td></tr>';
  const topicsThisWeek = digest.topicsThisWeek.length ? digest.topicsThisWeek.join(', ') : 'None this week';
  return `<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#181816;">
    <h2 style="margin:0 0 4px;">${heading}</h2>
    <p style="color:#555;margin:0 0 20px;">Here's how <strong style="color:#181816;">${name}</strong> did on Claruno this week.</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr><td style="padding:4px 12px 4px 0;">Lessons this week</td><td style="padding:4px 0;color:#555;">${digest.lessonsThisWeek} / ${digest.weeklyTarget} target</td></tr>
      <tr><td style="padding:4px 12px 4px 0;">Current streak</td><td style="padding:4px 0;color:#555;">${digest.streak} week${digest.streak === 1 ? '' : 's'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;">Total checks (all time)</td><td style="padding:4px 0;color:#555;">${digest.totalChecks}${digest.accuracy !== null ? ` &middot; ${digest.accuracy}% correct on first try` : ''}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;">Topics covered this week</td><td style="padding:4px 0;color:#555;">${topicsThisWeek}</td></tr>
    </table>
    <h3 style="margin:0 0 8px;">Mastery by topic</h3>
    <table style="width:100%;border-collapse:collapse;">${topicsRows}</table>
    <p style="color:#999;font-size:12px;margin-top:32px;">You're receiving this because you were added as a progress-report recipient on Claruno. <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe</a>.</p>
  </div>`;
}

async function sendEmail(to, subject, html, resendKey, fromAddress) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromAddress, to, subject, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Resend send failed: ${res.status} ${detail}`);
  }
}

// The full weekly job: every active (not unsubscribed) recipient across
// every account gets one email. Returns a small summary for logging —
// never throws for an individual failure, so one bad row/address can't
// stop the rest of the batch.
async function sendAllProgressReports(baseUrl) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !resendKey) {
    return { sent: 0, failed: 0, skipped: 'missing SUPABASE_SERVICE_ROLE_KEY or RESEND_API_KEY' };
  }
  const fromAddress = process.env.PROGRESS_REPORT_FROM || 'Claruno <onboarding@resend.dev>';

  const recipients = await restGet(
    'progress_recipients?unsubscribed_at=is.null&select=id,user_id,email,unsubscribe_token',
    serviceKey
  );
  const byUser = new Map();
  recipients.forEach((r) => {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  });

  let sent = 0, failed = 0;
  for (const [userId, userRecipients] of byUser) {
    let digest;
    try {
      digest = await computeDigest(userId, serviceKey);
    } catch (err) {
      failed += userRecipients.length;
      continue;
    }
    for (const r of userRecipients) {
      try {
        const unsubscribeUrl = `${baseUrl}/api/unsubscribe?token=${r.unsubscribe_token}`;
        await sendEmail(r.email, subjectLine(digest), renderDigestHtml(digest, unsubscribeUrl), resendKey, fromAddress);
        sent++;
      } catch (err) {
        failed++;
      }
    }
  }
  return { sent, failed };
}

module.exports = { sendAllProgressReports, computeDigest, renderDigestHtml, sendEmail, subjectLine };
