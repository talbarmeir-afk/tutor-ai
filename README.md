# Show your work — math mistake finder

Upload a photo of handwritten math work, or let your camera watch as you
write. AI finds the first mistake, draws a red-pen-style arrow at it,
explains what went wrong, and answers follow-up questions.

## How it's structured

- `index.html` — the frontend (static, no build step)
- `lib/anthropic.js` — shared logic for calling the Anthropic API
- `api/*.js` — serverless functions for **Vercel**
- `netlify/functions/*.js` — the same three endpoints for **Netlify**
- `netlify.toml` — maps `/api/*` to Netlify's function paths so the same
  frontend code works on either platform unchanged

The API key never reaches the browser — the frontend calls `/api/analyze`,
`/api/ask`, and `/api/watch` on your own domain, and those functions call
Anthropic server-side using an environment variable.

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
- History is saved after every upload-mode check, and after every watch-mode
  check that finds a mistake (not on every silent "still watching" tick).
- Entries are grouped by `problem_id` in the history panel — a fresh id is
  generated whenever the user starts genuinely new work (new photo/capture,
  camera start, or "Start a new problem"); "Continue this problem" reuses the
  current one. Run this migration if upgrading from an earlier version:

  ```sql
  alter table history_entries add column problem_id uuid not null default gen_random_uuid();
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
