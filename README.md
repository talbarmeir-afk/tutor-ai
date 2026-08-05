# Claruno — Your AI Teacher

Upload a photo of handwritten math work, or let your camera watch as you
write. Claruno finds the first mistake, draws a red-pen-style arrow at it,
explains what went wrong, and answers follow-up questions.

## How it's structured

- `index.html` — the frontend (static, no build step)
- `lib/anthropic.js` — shared logic for calling the Anthropic API
- `api/*.js` — serverless functions for **Vercel**
- `netlify/functions/*.js` — the same three endpoints for **Netlify**
- `netlify.toml` — maps `/api/*` to Netlify's function paths so the same
  frontend code works on either platform unchanged

The API key never reaches the browser — the frontend calls `/api/analyze`,
`/api/ask`, `/api/watch`, `/api/teach`, `/api/hint`, and
`/api/detectOrientation` on your own domain, and those functions call
Anthropic server-side using an environment variable.

`/api/hint` powers the "Give me a hint" button next to "Check my work":
it reads the uploaded work-in-progress and nudges the student toward the
next step — naming the operation or idea, or pointing them back at a step
worth re-checking — without ever revealing the corrected line or the final
answer.

`/api/teach` powers the "Teach me & train on a subject" option in the
dropdown next to "Check my scribbled work": the student types a math topic
and gets back a mini-lesson plus exactly one practice problem to solve by
hand (one at a time, like a real tutor), then checks their handwritten
solution through the normal photo/watch flow — teach mode adds no new
checking machinery. During a running lesson, a solution that checks out
as correct automatically requests the next practice problem through the
same conversation (a touch harder, still one at a time) until the lesson
clock runs out; a flagged mistake hands out nothing new until it's fixed. The lesson is rendered in a handwriting font on a
ruled-paper panel and "written out" progressively, and two icons under it
let the student ask for the same idea explained a different way or ask a
clarification question — both continue the same conversation through the
same endpoint (send `{subject}` for a fresh lesson, `{conversation}` for a
follow-up).

Once a work photo is frozen, both it and (in Homework mode) an optional
photo of the printed problem show as small thumbnails in an attachments
row next to Check/Hint — each with its own retake control, since a
problem from a book/worksheet is per-problem and optional, not something
every check needs. Adding a problem photo briefly swaps the box back to
the live feed (same rotation and zoom) to snap it, then restores the work
photo; once attached it's sent alongside every check/hint on that problem
(so re-checking after a fix doesn't mean re-photographing the book) until
removed or the problem changes. `/api/analyze` and `/api/hint` accept it
as an optional `problemBase64`/`problemMediaType` pair, shown to the model
before the work photo so it checks against the actual printed problem
instead of inferring it from the handwriting; omitted entirely, the
request is unchanged from before this existed. If attached, its thumbnail
is saved alongside the solution's in that history entry.

`/api/detectOrientation` powers automatic camera-rotation correction: once
per lesson, right as the live camera starts, a small sample frame is sent
for a fast yes/no-style read on how many degrees of rotation would make
any visible text upright — deliberately no extended thinking, since this
only needs to be quick, not deeply reasoned. It only runs if the student
hasn't already set (or had auto-detected) a rotation for that lesson, so
it never overrides a manual choice, and the rotate button still works
exactly as before for whenever it guesses wrong.

### Watch mode

"Watch with camera" isn't literal live video analysis — Claude's vision API
can't stream frame-by-frame. Instead, the browser samples the camera feed
client-side to detect a writing-then-pause pattern (motion, then ~1.5s of
stillness), and only then captures a frame and sends it to `/api/watch`.
That endpoint is stateless like the others; the browser tracks a small
`priorState` (the last confirmed-correct line, and any still-unresolved
flagged mistake) and sends it with each check so the model only evaluates
what's new since the last check, rather than re-reading the whole page each
time. See the constants at the top of the "Watch mode" section in
`index.html` (`MOTION_STABLE_MS`, `MIN_CHECK_INTERVAL_MS`, etc.) if checks
fire too eagerly or too late for your setup — they're tuned starting points,
not fixed values.

### Lesson timer

A lesson only exists once a signed-in student clicks **Start Lesson** — there's
no timer running before that. Clicking it starts a 45-minute countdown
(shown as a pill in the top bar) and reveals the upload/watch UI, which is
otherwise hidden behind the Start Lesson prompt. A lesson ends automatically
when the countdown hits zero, or immediately on logout, and an ended lesson
can never be resumed — the checking UI is replaced by a "Lesson ended" note
with the actual time worked, and the only way to keep going is **Start a new
lesson**, which gets a fresh id and a fresh 45 minutes.

Each lesson is a row in the `lessons` table (`id`, `user_id`, `started_at`,
`ended_at`, `duration_seconds`), written via `startLessonRecord`/
`endLessonRecord` on `window.mathTutorHistory`. `duration_seconds` is the
*actual* elapsed time — 45:00 if it timed out, less if it was cut short by
logout — and is what the history panel's lesson header shows. On logout,
the end record is written *before* `supabaseClient.auth.signOut()` runs,
since the update needs the still-valid session to pass the `lessons` RLS
policy. An in-progress (not yet ended) lesson's `{id, startedAt}` is cached
in `localStorage` (key `mathTutorActiveLesson:<user id>`) purely so an
accidental page refresh mid-lesson doesn't lose it — nothing is cached once
a lesson ends. Migration:

```sql
create table if not exists lessons (
  id uuid primary key,
  user_id uuid references auth.users not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer
);
alter table lessons enable row level security;
create policy "Users can view their own lessons" on lessons for select using (auth.uid() = user_id);
create policy "Users can insert their own lessons" on lessons for insert with check (auth.uid() = user_id);
create policy "Users can update their own lessons" on lessons for update using (auth.uid() = user_id);
```

### Login and history (Supabase)

Signing in lets a student's check history (thumbnail + verdict) follow them
across devices. This is powered by [Supabase](https://supabase.com) — free
tier, handles both auth and the database — wired up in a second `<script
type="module">` block at the end of `index.html`, kept deliberately separate
from the main script so a Supabase/CDN failure can't break the core
check/analyze features.

- The Supabase **URL** and **anon public key** are hardcoded in that script.
  This is intentional and safe: unlike the Anthropic key, Supabase's anon key
  is designed to be public — access is enforced by the Row Level Security
  policies on the `history_entries` table (each user can only read/write
  their own rows), not by keeping the key secret.
- To point this at your own Supabase project: create one, run the SQL in the
  project's setup notes (creates `history_entries` with RLS policies scoped
  to `auth.uid() = user_id`), then swap `SUPABASE_URL` and
  `SUPABASE_ANON_KEY` in `index.html` for your project's values (Project
  Settings → API).
- **"Continue with Google"** calls `supabaseClient.auth.signInWithOAuth({
  provider: 'google' })` — one button handles both sign-in and sign-up,
  since OAuth doesn't distinguish them (Supabase creates the account on
  first use). This needs a one-time setup outside the code, in two places:
  1. **Google Cloud Console** → APIs & Services → Credentials → create an
     OAuth 2.0 Client ID (type: Web application). Add
     `https://<your-project-ref>.supabase.co/auth/v1/callback` as an
     authorized redirect URI.
  2. **Supabase dashboard** → Authentication → Providers → Google → enable
     it and paste that Client ID and Client Secret in.

  Until both are done, the button surfaces whatever error Supabase returns
  (e.g. "provider is not enabled") instead of silently failing.
- **Invite-only signup**: to restrict who can create an account (email/
  password or Google alike) to an allowlist, without touching any app code,
  run this once in the Supabase SQL Editor:

  ```sql
  create table if not exists public.allowed_emails (
    email text primary key
  );
  alter table public.allowed_emails enable row level security;
  -- No policies are added on purpose — this table is intentionally
  -- unreachable via the public anon/authenticated API keys. Manage it
  -- from the Supabase dashboard's Table Editor or SQL Editor only.

  create or replace function public.check_allowed_email(event jsonb)
  returns jsonb
  language plpgsql
  security definer
  as $$
  declare
    user_email text;
  begin
    user_email := lower(event->'user'->>'email');
    if exists (select 1 from public.allowed_emails where email = user_email) then
      return '{}'::jsonb;
    end if;
    return jsonb_build_object(
      'error', jsonb_build_object(
        'message', 'Claruno is currently invite-only. Contact us if you believe you should have access.',
        'http_code', 403
      )
    );
  end;
  $$;

  grant execute on function public.check_allowed_email to supabase_auth_admin;
  revoke execute on function public.check_allowed_email from authenticated, anon, public;

  -- Add whoever should be allowed in, e.g.:
  -- insert into public.allowed_emails (email) values ('you@example.com');
  ```

  Then in the dashboard: **Authentication → Hooks → Before User Created** →
  choose **Postgres Function** → select `check_allowed_email`. This one hook
  covers both signup paths, since Supabase fires it for any new account
  regardless of provider — nothing in `index.html` needs to change. It only
  blocks *new* signups; an account created before you add someone's email
  can still sign back in unless you also add a **Before Token Generated**
  hook doing the same lookup.
- **Guest daily check limit**: signed-out visitors are capped at 3 checks/
  hints per day, enforced server-side in `lib/guestLimit.js` (not just in
  the browser, since the anon key is public and a client-only limit would
  be trivial to bypass). It's keyed to a hashed IP address, since guests
  have no account to key it to. Set this up once in the Supabase SQL
  Editor:

  ```sql
  create table if not exists public.guest_check_counts (
    ip_hash text not null,
    day date not null default current_date,
    count integer not null default 0,
    primary key (ip_hash, day)
  );
  alter table public.guest_check_counts enable row level security;
  -- No policies here either — same reasoning as allowed_emails. Only
  -- code holding the service_role key (never the browser) can touch it.

  create or replace function public.try_guest_check(p_ip_hash text, p_limit integer)
  returns boolean
  language plpgsql
  security definer
  as $$
  declare
    new_count integer;
  begin
    insert into public.guest_check_counts (ip_hash, day, count)
    values (p_ip_hash, current_date, 0)
    on conflict (ip_hash, day) do nothing;

    update public.guest_check_counts
    set count = count + 1
    where ip_hash = p_ip_hash and day = current_date and count < p_limit
    returning count into new_count;

    return new_count is not null;
  end;
  $$;

  grant execute on function public.try_guest_check to service_role;
  revoke execute on function public.try_guest_check from authenticated, anon, public;
  ```

  Then set `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API → service_role
  secret key — **never** the anon key) as an environment variable on
  Vercel/Netlify, same place `ANTHROPIC_API_KEY` lives. A signed-in user is
  detected by sending their Supabase access token along with the request and
  verifying it against Supabase's own `/auth/v1/user` endpoint server-side
  (not just checking that *some* token was present, which would be trivial
  to fake) — signed-in users are exempt from the limit entirely.

  If the env var isn't set, or Supabase is unreachable, the limiter fails
  *open* (checks still work, just unlimited) rather than breaking the core
  feature for everyone over an optional guardrail — same philosophy as the
  rest of this app's Supabase integration.
- History is saved after every upload-mode check, and after every watch-mode
  check that finds a mistake (not on every silent "still watching" tick).
- Entries are grouped by `problem_id` in the history panel — a fresh id is
  generated whenever the user starts genuinely new work (new photo/capture,
  camera start, or "Start a new problem"); "Continue this problem" reuses the
  current one. Run this migration if upgrading from an earlier version:

  ```sql
  alter table history_entries add column problem_id uuid not null default gen_random_uuid();
  ```
- Each group is labeled with a `problem_title` the model generates alongside
  its usual verdict — the original equation verbatim for straightforward
  equation problems, or a one-line "Topic: description" for anything else
  (geometry, word problems, etc.). Migration:

  ```sql
  alter table history_entries add column problem_title text;
  ```

- Problem groups are further grouped under a lesson in the history panel.
  A lesson is a single 45-minute sitting: `currentLessonId`/`lessonStartTime`
  are generated on page load and cached in `localStorage` (`mathTutorLesson`)
  so a refresh mid-lesson resumes the same countdown and id instead of
  starting a new one; once 45 minutes have passed, the next page load mints a
  fresh lesson. The countdown pill in the top bar reflects this client-side
  timer only — there's no server-side lesson record beyond the `lesson_id`
  stamped on each history row. Migration:

  ```sql
  alter table history_entries add column lesson_id uuid;
  ```

### Tabs: Dashboard, Profile, Settings

Once signed in, a tab bar (Home / Dashboard / Profile / Settings) appears
above the main panel — hidden entirely for guests, who only ever see Home,
same as before tabs existed. Each tab's data loads lazily the first time
it's opened (`window.mathTutorProfile.loadDashboard/loadProfile/loadSettings`),
not eagerly on sign-in.

- **Home** splits into two subtabs once signed in: **Start Lesson** (the
  lesson flow, plus a live "This lesson so far" log of the current
  lesson's checks) and **Past Lessons** (the full history, inline — the
  old modal is gone). A lesson's header row shows its date, duration
  (real when it ended cleanly, "in progress" for the active one, an
  estimate when the tab was closed mid-lesson), and its type: "Homework",
  or "New topic: …" listing the subjects taught via Teach me during that
  lesson. Migration for the type column:

  ```sql
  alter table lessons add column if not exists taught_subjects text;
  ```
  Each check's saved photo has its mark (checkmark or circled mistake)
  baked in — composited from the same overlay drawn live, at save time —
  so history shows exactly what the student saw, not a blank re-upload.
  Any follow-up on that check ("explain in more detail", or a typed
  question) is saved too and shown behind a "Show conversation" toggle,
  so nothing discussed about a problem is lost once the student moves on.
- **Dashboard**'s per-topic mastery tags are clickable — they open Past
  Lessons filtered to just that topic (clear the filter to see everything
  again). Shows lessons-this-week vs. a weekly target, a streak (
  consecutive weeks meeting that target — a week still in progress doesn't
  break the streak, only a completed week that fell short does), an 8-week
  bar chart, and a per-topic mastery list. Mastery is a simple
  correct-checks ÷ total-checks ratio per topic (Mastered ≥85%, Proficient
  ≥60%, Developing ≥35%, else Needs practice), gated behind a minimum of 3
  checks so one lucky or unlucky answer can't swing the label — see
  `masteryFor()`. This is a heuristic, not a real assessment model; there's
  no other signal available from check history to base it on.
- **Profile** holds student info (name, school, class, country, language),
  a weekly AI-lesson schedule (pick any set of days, each with its own
  time, plus a shared duration — days are stored comma-joined in the
  existing `schedule_day` text column and the per-day times as a JSON map
  in the existing `schedule_time` text column, so no migration needed;
  older single-time rows load as that time on every selected day.
  **Stored only**: nothing sends reminders or auto-starts a lesson from
  this schedule), a simple add/delete list of tests (subject, date,
  optional score), and a list of **progress-report recipients** — see
  below.

  Adding an email there gets it a weekly digest (lessons vs. target,
  streak, per-topic mastery, total checks/accuracy) — stats only, no
  photos of the student's work, since a recurring email to a third-party
  inbox is a bigger privacy step than an in-app check. Sent by a
  scheduled job (`api/cron/send-progress-reports.js` on Vercel,
  `netlify/functions/send-progress-reports.js` on Netlify, both calling
  the shared `lib/progressReport.js`), every Monday, via
  [Resend](https://resend.com). Needs three things beyond what's already
  set up:

  1. A `RESEND_API_KEY` environment variable (see `.env.example`) — the
     free tier works to start, though mail can only go out from Resend's
     shared `onboarding@resend.dev` address until you verify your own
     sending domain with them.
  2. `SUPABASE_SERVICE_ROLE_KEY` (also needed for the guest check limit,
     above) — the cron job reads across every account's data in one
     batch run, which the public anon key can't do.
  3. This migration, run once in the Supabase SQL Editor:

  ```sql
  create table if not exists public.progress_recipients (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references auth.users not null,
    email text not null,
    unsubscribe_token uuid not null default gen_random_uuid(),
    unsubscribed_at timestamptz,
    created_at timestamptz not null default now(),
    unique(user_id, email)
  );
  alter table public.progress_recipients enable row level security;
  create policy "Users can view their own recipients" on progress_recipients for select using (auth.uid() = user_id);
  create policy "Users can insert their own recipients" on progress_recipients for insert with check (auth.uid() = user_id);
  create policy "Users can delete their own recipients" on progress_recipients for delete using (auth.uid() = user_id);
  ```

  Each email in the digest includes an unsubscribe link
  (`/api/unsubscribe?token=…`) that works without logging in — the
  recipient is often a parent/teacher who isn't a Claruno account holder
  at all, just an email address the student added.

  The student's own account email is added as a recipient automatically
  the first time this section loads (removable, and it won't come back
  once removed — tracked client-side per account, not just "list is
  currently empty"). A **Send a test email** button next to the list
  sends that same signed-in user a one-off copy of their own digest
  immediately (`/api/test-progress-report`), so setup can be verified
  without waiting for Monday.
- **Settings** has account (email, password change via
  `supabaseClient.auth.updateUser`), and placeholder Billing/Integrations
  sections — no real payment processing or third-party connections exist
  yet; wiring either up is a separate project.

Topics come from a fixed list the model chooses from (`TOPICS` in
`lib/anthropic.js`) — added to both `ANALYSIS_PROMPT` and `buildWatchPrompt`
(and their client-side copy in `index.html`) so Dashboard grouping is
consistent rather than parsing free-text titles. Migration (combines
everything tabs need — topic column, `profiles`, `exams`):

```sql
alter table history_entries add column if not exists topic text;
alter table history_entries add column if not exists problem_thumbnail text;
alter table history_entries add column if not exists qa jsonb;
alter table history_entries add column if not exists skipped boolean not null default false;

create table if not exists profiles (
  user_id uuid primary key references auth.users,
  first_name text,
  last_name text,
  school text,
  class_name text,
  country text,
  language text,
  schedule_day text,
  schedule_time text,
  schedule_duration_minutes integer default 45,
  weekly_target_lessons integer default 3,
  updated_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "Users can view their own profile" on profiles for select using (auth.uid() = user_id);
create policy "Users can insert their own profile" on profiles for insert with check (auth.uid() = user_id);
create policy "Users can update their own profile" on profiles for update using (auth.uid() = user_id);

create table if not exists exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  subject text not null,
  exam_date date not null,
  score integer,
  created_at timestamptz not null default now()
);
alter table exams enable row level security;
create policy "Users can view their own exams" on exams for select using (auth.uid() = user_id);
create policy "Users can insert their own exams" on exams for insert with check (auth.uid() = user_id);
create policy "Users can update their own exams" on exams for update using (auth.uid() = user_id);
create policy "Users can delete their own exams" on exams for delete using (auth.uid() = user_id);
```

## Local development

You'll need a free Anthropic API key: https://console.anthropic.com/settings/keys

```bash
cp .env.example .env
# edit .env and paste your key in place of sk-ant-...
```

Then run either platform's CLI dev server (installs nothing globally beyond
the CLI itself):

```bash
# Vercel
npx vercel dev

# or Netlify
npx netlify dev
```

Both serve the site at a local URL with `/api/*` wired up to the functions.

## Deploying

See the deployment walkthrough your assistant gave you, or in short:
push this repo to GitHub, import it in Vercel or Netlify, and set
`ANTHROPIC_API_KEY` as an environment variable in the project's dashboard.
