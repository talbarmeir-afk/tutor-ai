// Shared Anthropic API logic used by both the Vercel (api/) and Netlify
// (netlify/functions/) handlers, so the request/response shaping only
// needs to be written once per platform, not the model-calling logic.

const ANTHROPIC_VERSION = '2023-06-01';
// Sonnet 5 rather than Opus: newer generation, strong at math + vision,
// and its extended thinking runs fast enough that a full line-by-line
// recheck fits comfortably inside the serverless 60s maxDuration —
// Opus with the same thinking budget sat right at the timeout edge.
const MODEL = 'claude-sonnet-5';

// Fixed list so topics group cleanly for the Dashboard's per-topic mastery
// view — the model must pick exactly one of these per check, never invent
// its own label.
const TOPICS = ['Algebra', 'Geometry', 'Arithmetic', 'Fractions & Decimals', 'Word Problems', 'Trigonometry', 'Calculus', 'Statistics & Probability', 'Other'];
const TOPIC_LIST_TEXT = TOPICS.map((t) => `"${t}"`).join(', ');

const ANALYSIS_PROMPT = `Look at this photo of handwritten math work.

STEP 1 — Before anything else, scan every line closely for a strikethrough, cross-out scribble, or diagonal/horizontal line drawn through it. This is a distinct visual mark on top of the handwriting, not just messy writing — look carefully at each line individually, since these marks are easy to miss, especially on graph/grid paper where a thin line can blend into the grid. Write down the exact text of every crossed-out line you find (there may be none).

Apply the same rule WITHIN lines to individual characters: a single digit, sign, or term with a scribble drawn over it has been deleted by the student. Read the line as if that token were not there, and if a replacement is written next to, above, or over the scribble, read the replacement in its place. Never interpret the scribble mark itself as a character — a scribbled-over blob is not a 3, an x, or anything else, and must not be silently merged into the term next to it.

STEP 2 — Read the work from top to bottom as the student's solution to one problem, treating each distinct equation or step as one "line" (ignore blank space between them). Completely skip every line you listed in Step 1 — treat each one as if it were never written at all, and continue reading as though the student's next line follows directly from the last non-crossed-out line before it.

STEP 3 — Solve the problem yourself, from the original first line, completely independently of the student's work, and note your own final answer. This is not optional — you will compare against it in Step 5.

STEP 4 — Among the remaining (non-crossed-out) lines only, go through them one at a time and actually recompute the arithmetic of every single step yourself. Never judge a step by whether it looks plausible: sign slips like writing "12x = 17" after "12x + 37 = 20" (really 20 − 37 = −17) look fine at a glance and are only caught by doing the subtraction. Find the first line with a mathematical error (an incorrect step, wrong sign, dropped term, arithmetic slip, etc), and identify the specific wrong token within that line — the particular number, sign, or term that is actually incorrect (not just the line as a whole). If all remaining lines are correct, note that instead (point at the last written non-crossed-out line).

STEP 5 — Before answering, run BOTH of these checks:
(a) Does the line you're about to report as the mistake match any line in your Step 1 list? If so, that's wrong — go back and use the next non-crossed-out line instead. A line from your Step 1 list must never be the line_quote you report.
(b) Does the student's final answer exactly match the answer you computed yourself in Step 3 (including its sign)? If it does not match, there IS a mistake in the work and you must not report has_mistake: false — go back through the lines until you find the step where the work diverges from yours.

Also produce a short problem_title describing the overall problem being solved: if it's a straightforward equation-solving problem, use the original equation exactly as first written as the title (e.g. "2x + 5 = 15"). If it's a different kind of problem — geometry, a word problem, multi-part, etc. — write a brief one-line description in the style "Topic: short description" (e.g. "Geometry: Pythagorean triangle calculation").

Also classify the problem into exactly one topic from this fixed list, choosing whichever fits best even if imperfectly: ${TOPIC_LIST_TEXT}.

Respond with ONLY this JSON object, no markdown fences, no extra text:
{"has_mistake": true or false, "problem_title": "short label for the overall problem, per the instructions above", "topic": "exactly one topic from the fixed list above", "crossed_out_lines": array of exact text strings for each line identified as crossed out in Step 1 (empty array if none), "line_quote": "short exact snippet of text/expression from that line", "wrong_token": "the exact incorrect number, sign, or term as written (empty string if no mistake)", "explanation": "1-2 plain sentences on what's wrong", "fix": "one sentence on the correct step, or empty string if there's no mistake", "y": percent from the top edge of the photo to the vertical center of the specific wrong token, "x": percent from the left edge of the photo to the horizontal position of the specific wrong token, "total_lines": total count of distinct handwritten lines visible in the photo counted top to bottom — INCLUDING crossed-out lines and the original problem line; a fraction (number over a bar over a number) counts as ONE line, "mistake_line_index": which of those lines (1-based from the top, same counting) contains the mistake, or 0 if has_mistake is false}

A light blue coordinate grid with percent labels is drawn over the photo purely to help you report positions: the numbers along the top edge are x percentages and the numbers along the left edge are y percentages. The grid is NOT part of the student's work — ignore it when reading the math. Read x and y directly off the nearest gridlines instead of estimating proportions by eye.

For x and y: point at the exact wrong token itself (e.g. the specific incorrect number or sign), not the start of the line and not the line's overall center — if the error is a number partway through or at the end of the line, x/y should land on that number, not on the beginning of the equation. Use this procedure: (1) find the mistake line in the photo and note where its writing starts and ends horizontally; (2) place the wrong token within the line by reading order — for example, if the line is "12x = 17" and the wrong token is the "17", that token sits AFTER the "=" sign near the right end of the written line, so x must be clearly to the right of the "=" — never over the "12x" at the start; (3) verify before answering: an imaginary circle centered at your (x, y) about a tenth of the image wide must contain the wrong token and must NOT contain the first characters of the line — if it fails, move x/y and re-verify. Look directly at the token's pixel position in the photo; do not estimate it from the line's position in a numbered sequence or assume lines are evenly spaced. The photo may be tilted, rotated, or taken at an angle — base x/y on the token's actual pixel position in the photo exactly as captured, not on where it would sit if the page were flattened and upright.`;

const QA_SYSTEM = 'You are a friendly, encouraging math teacher. You already reviewed this student\'s handwritten work and gave feedback. Answer their follow-up question about that feedback in 2-4 plain spoken sentences. No markdown, no JSON, no code fences — just talk to them directly.';

// Builds the prompt for one incremental "watch mode" check. Kept as a pure
// function of priorState (no server-side session storage) so the exact same
// prompt can be reconstructed client-side from the same priorState snapshot
// when building conversation history for follow-up Q&A — see the duplicate
// of this function in index.html.
function buildWatchPrompt(priorState) {
  const reviewed = priorState && priorState.reviewedThrough
    ? `You have already checked this student's work and confirmed everything up through and including this line was correct: "${priorState.reviewedThrough}". Do not re-flag anything at or before that point — only evaluate content written after it.`
    : `This is the first check — nothing has been reviewed yet.`;

  const pending = priorState && priorState.pendingMistake
    ? `On your last check you flagged an unresolved mistake: the line was "${priorState.pendingMistake.line_quote}" — ${priorState.pendingMistake.explanation} Check first whether the student has since corrected this specific mistake.`
    : `There is no previously-flagged mistake to check on.`;

  return `You are watching a student's handwritten math work through a webcam, checking in periodically as they write one problem, top to bottom, treating each distinct equation or step as one "line".

${reviewed}
${pending}

Before evaluating anything, scan every line closely for a strikethrough, cross-out scribble, or diagonal/horizontal line drawn through it — a distinct visual mark on top of the handwriting, not just messy writing. It's easy to miss, especially on graph/grid paper where a thin line can blend into the grid, so look carefully at each line individually. Students often cross out a wrong step and rewrite the fix right next to or below it. Write down the exact text of every crossed-out line you find (there may be none) — you'll report this list and must check your answer against it before responding. Apply the same rule WITHIN lines to individual characters: a single digit, sign, or term with a scribble drawn over it has been deleted — read the line as if that token were not there, use any replacement written next to, above, or over the scribble in its place, and never interpret the scribble mark itself as a character or merge it into the term beside it.

Now look at the current photo and report on the CURRENT state of the work:
- For every new line since the last reviewed point, actually recompute the arithmetic yourself step by step rather than skimming and assuming it looks plausible — this is the most common way real mistakes get missed, especially on simple steps like isolating a variable (e.g. going from "2a = 6" to "a = 2" instead of "a = 3") or a sign slip (e.g. "12x = 17" after "12x + 37 = 20", where 20 − 37 is really −17).
- Also solve the problem yourself from the original first line, independently, and compare answers: if the student's latest result does not exactly match your own independently computed value (including its sign), there IS a mistake somewhere in the work — never report has_mistake: false while the results disagree.
- Skip every line from your crossed-out list entirely, as if it were never written, and evaluate whatever follows it as the actual current step. If a crossed-out line was the previously-flagged mistake, set mistake_resolved to true.
- If there is a previously-flagged mistake and it is still present uncorrected (not crossed out), has_mistake should be true, mistake_resolved should be false, and the mistake fields should describe that same original mistake.
- If a previously-flagged mistake has been corrected, set mistake_resolved to true. Then also check whether the work continues correctly after that fix, or whether a new mistake exists further down — if so has_mistake should be true describing that new mistake; otherwise has_mistake should be false.
- If there was no pending mistake, check only the content written since the last reviewed line: if it's all correct so far, has_mistake should be false; if there's a mistake in it, has_mistake should be true.
- Either way, set reviewed_through to a short exact snippet of the last written line that is now confirmed fully correct (the line immediately before any currently-unresolved mistake, or the last written line if everything so far is correct).
- Before answering, check: does the line you're about to report as the mistake match any line in your crossed-out list? If so, that's wrong — go back and use the next non-crossed-out line instead.
- Also produce a short problem_title describing the overall problem: if it's a straightforward equation-solving problem, use the original equation exactly as first written as the title (e.g. "2x + 5 = 15"). If it's a different kind of problem — geometry, a word problem, multi-part, etc. — write a brief one-line description in the style "Topic: short description" (e.g. "Geometry: Pythagorean triangle calculation").
- Also classify the problem into exactly one topic from this fixed list, choosing whichever fits best even if imperfectly: ${TOPIC_LIST_TEXT}.

Respond with ONLY this JSON object, no markdown fences, no extra text:
{"has_mistake": true or false, "mistake_resolved": true or false, "problem_title": "short label for the overall problem, per the instructions above", "topic": "exactly one topic from the fixed list above", "crossed_out_lines": array of exact text strings for each crossed-out line you found (empty array if none), "line_quote": "short exact snippet of text/expression from the current mistake line, or empty string if has_mistake is false", "wrong_token": "the exact incorrect number, sign, or term as written, or empty string if has_mistake is false", "explanation": "1-2 plain sentences on what's wrong, or empty string if has_mistake is false", "fix": "one sentence on the correct step, or empty string if has_mistake is false", "y": percent from the top edge of the photo to the vertical center of the specific wrong token (or 50 if has_mistake is false), "x": percent from the left edge of the photo to the horizontal position of the specific wrong token (or 50 if has_mistake is false), "reviewed_through": "short exact snippet of the last confirmed-correct written line, or empty string if nothing is confirmed correct yet", "total_lines": total count of distinct handwritten lines visible in the photo counted top to bottom — INCLUDING crossed-out lines and the original problem line; a fraction (number over a bar over a number) counts as ONE line, "mistake_line_index": which of those lines (1-based from the top, same counting) contains the mistake, or 0 if has_mistake is false}

A light blue coordinate grid with percent labels is drawn over the photo purely to help you report positions: the numbers along the top edge are x percentages and the numbers along the left edge are y percentages. The grid is NOT part of the student's work — ignore it when reading the math. Read x and y directly off the nearest gridlines instead of estimating proportions by eye.

For x and y (only when has_mistake is true): point at the exact wrong token itself — the specific incorrect number, sign, or term — not the start of the line. Place it by reading order within the line: if the wrong token comes after the "=" sign (e.g. the "17" in "12x = 17"), x must be clearly to the right of the "=", never over the start of the line. Verify before answering: an imaginary circle centered at your (x, y) about a tenth of the image wide must contain the wrong token and must NOT contain the first characters of the line. The photo may be tilted, rotated, or taken at an angle — base x/y on the token's actual pixel position in the photo exactly as captured, not on where it would sit if the page were flattened and upright.`;
}

async function callAnthropic(body) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Server is missing the ANTHROPIC_API_KEY environment variable.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const message = (data && data.error && data.error.message) || `Anthropic API error (${response.status})`;
    throw new Error(message);
  }
  return data;
}

// Both checking calls run with extended thinking enabled: the model gets a
// private scratchpad to actually recompute the student's arithmetic before
// committing to a verdict, instead of having to emit "correct/incorrect"
// JSON straight from a visual skim. This is the main defense (together with
// the solve-it-yourself-and-compare steps in the prompts) against plausible-
// looking sign slips being waved through. The .find(type === 'text') below
// already skips the thinking blocks in the response.
// Sonnet 5 uses adaptive thinking (the legacy {type:'enabled',
// budget_tokens} shape is rejected for it): the model decides how much
// private reasoning each check needs, and output_config.effort biases it
// toward being thorough. High effort is the point here — the scratchpad
// is what lets it actually recompute every line instead of skimming.
const CHECK_THINKING = { type: 'adaptive' };
const CHECK_OUTPUT_CONFIG = { effort: 'high' };

// problemImage is optional: { base64, mediaType } for a photo of the
// printed problem (book/worksheet), shown to the model before the work
// photo so it can check against the actual problem statement instead of
// inferring it from the handwriting alone. Omitted entirely when there's
// no problem photo — the single-image request is byte-for-byte the same
// as before this existed.
function buildWorkContent(base64, mediaType, problemImage) {
  const content = [];
  if (problemImage && problemImage.base64) {
    content.push({ type: 'text', text: 'The next image is the PRINTED PROBLEM the student is solving, photographed from a book or worksheet — use it as the actual problem statement and target answer instead of inferring the problem from the handwriting alone.' });
    content.push({ type: 'image', source: { type: 'base64', media_type: problemImage.mediaType || 'image/jpeg', data: problemImage.base64 } });
    content.push({ type: 'text', text: 'The next image is the student\'s handwritten work solving that problem:' });
  }
  content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
  return content;
}

async function analyzeImage(base64, mediaType, problemImage) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 5000,
    thinking: CHECK_THINKING,
    output_config: CHECK_OUTPUT_CONFIG,
    system: 'You are a careful, encouraging math teacher. Respond with ONLY the JSON object requested — no markdown code fences, no commentary before or after it.',
    messages: [{
      role: 'user',
      content: [
        ...buildWorkContent(base64, mediaType, problemImage),
        { type: 'text', text: ANALYSIS_PROMPT },
      ],
    }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The model did not return a text response.');
  return textBlock.text;
}

async function checkWatch(base64, mediaType, priorState) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 5000,
    thinking: CHECK_THINKING,
    output_config: CHECK_OUTPUT_CONFIG,
    system: 'You are a careful, encouraging math teacher. Respond with ONLY the JSON object requested — no markdown code fences, no commentary before or after it.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: buildWatchPrompt(priorState) },
      ],
    }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The model did not return a text response.');
  return textBlock.text;
}

// Powers the "Give me a hint" button: reads the work in progress and
// nudges the student toward the next step without revealing it. Runs with
// the same thinking config as the checkers — a hint based on misread or
// unverified arithmetic is worse than no hint.
async function hintFromImage(base64, mediaType, problemImage) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 4000,
    thinking: CHECK_THINKING,
    output_config: CHECK_OUTPUT_CONFIG,
    system: 'You are a patient, encouraging math teacher sitting next to a student. Respond in plain text only — no markdown, no JSON, no code fences.',
    messages: [{
      role: 'user',
      content: [
        ...buildWorkContent(base64, mediaType, problemImage),
        { type: 'text', text: `Look at this photo of my handwritten math work in progress.

First, work it out for yourself: what problem am I solving, which steps have I completed so far, and is my work so far correct? Actually recompute my arithmetic — do not skim. (A line with a scribble drawn over a character means that character was deleted; read any replacement written next to it in its place.)

Then give me ONE hint that guides me from exactly where I stopped to the next step:
- If my work so far is correct, hint at what to do next — name the operation or idea, not the result (say "try moving the constant term to the other side", never "subtract 37 to get -17").
- If there is a mistake in what I wrote, do not reveal the correction — gently point me back to re-check that specific step (say "take another look at the sign when you moved the 37 across").
- Never state the final answer and never write out the next line for me.

Answer in 1-3 short, encouraging sentences spoken directly to me.` },
      ],
    }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The model did not return a text response.');
  return textBlock.text.trim();
}

// Powers the "Teach me & train on a subject" mode: a mini-lesson plus one
// practice problem the student solves by hand and then checks through the
// normal photo/watch flow. The frontend renders the reply in a handwriting
// font on ruled paper, so the system prompt asks for short hand-written
// lines rather than typed prose. No session state server-side — follow-ups
// resend the whole conversation, same pattern as /api/ask.
const TEACH_SYSTEM = `You are a friendly, encouraging math teacher writing by hand on a sheet of paper for one student. Respond in plain text only — no markdown, no code fences, no asterisks, no bullet symbols. Write the way you would on paper: short lines of at most about 45 characters (insert your own line breaks), one idea or one step per line, with a blank line between separate ideas.`;

async function teachSubject(subject) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1200,
    system: TEACH_SYSTEM,
    messages: [{
      role: 'user',
      content: `Teach me this math topic: "${subject}".

First give a short mini-lesson: explain the core idea in a few plain sentences, then walk through one small worked example step by step, the way you'd scribble it on paper while sitting next to me.

Then present exactly ONE practice problem for me to solve by hand on paper, labelled "Problem:", matched to that topic at a typical school level. One problem only — I'll get another after this one is checked. Do not include the answer.

Close with one short sentence telling me to write my solution by hand and have Claruno check it.`,
    }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The model did not return a text response.');
  return textBlock.text.trim();
}

// Follow-ups on the lesson ("explain it differently", clarification
// questions) reuse the same teacher-writing-on-paper voice, with the full
// conversation resent from the client each time.
async function teachFollowup(conversation) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1200,
    system: TEACH_SYSTEM,
    messages: conversation,
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('The model did not return a text response.');
  return textBlock.text.trim();
}

async function askFollowup(conversation) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1000,
    system: QA_SYSTEM,
    messages: conversation,
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text.trim() : "I couldn't come up with an answer to that — try rephrasing?";
}

module.exports = { analyzeImage, askFollowup, checkWatch, hintFromImage, teachSubject, teachFollowup, buildWatchPrompt, ANALYSIS_PROMPT, TOPICS };
