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

const ANALYSIS_PROMPT = `Look at this photo, which is meant to show handwritten math work.

STEP 0 — Before anything else, decide whether this photo can actually be checked at all. Set unreadable to true (and leave has_mistake as false) if ANY of these apply:
(a) there is no handwritten or printed math work visible anywhere in the frame — a blank page, an empty desk, a laptop, a phone, a person, furniture, or anything without legible math content;
(b) the photo is too blurry, dark, or obscured to actually read;
(c) the frame cuts off part of the work in a way that stops you from actually verifying the completed result — for example the final line/answer is itself cut off, or a step partway through is cut off such that you cannot confirm what follows from it is correct.
If unreadable is true, set explanation to one plain sentence describing specifically what's wrong (what's missing, cut off, or unreadable) — then skip every step below and go straight to the JSON response. "I can't verify this" is NOT the same as "it's correct" — never report has_mistake: false just because you couldn't actually check something.

If the photo IS clear and complete enough to genuinely verify the work — even if some earlier, already-superseded line is slightly cropped at an edge without affecting your ability to confirm the final result — continue with the steps below (unreadable stays false). Treat any such minor cut-off line as unread and never guess what it said; base your check only on what's actually visible.

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

Write explanation and fix speaking directly TO the student as "you" (e.g. "you subtracted 37 instead of adding it" or "you're on the right track — try..."), the way a teacher would say it out loud sitting next to them. Never write in the third person — never say "the student" or "they".

Respond with ONLY this JSON object, no markdown fences, no extra text:
{"unreadable": true or false, per Step 0, "has_mistake": true or false — always false when unreadable is true, "problem_title": "short label for the overall problem, per the instructions above — empty string if unreadable is true", "topic": "exactly one topic from the fixed list above — best guess or \"Other\" if unreadable is true", "crossed_out_lines": array of exact text strings for each line identified as crossed out in Step 1 (empty array if none), "line_quote": "short exact snippet of text/expression from that line", "wrong_token": "the exact incorrect number, sign, or term as written (empty string if no mistake)", "explanation": "1-2 plain sentences on what's wrong, or — if unreadable is true — one plain sentence on what's wrong with the photo (missing, cut off, or unreadable)", "fix": "one sentence on the correct step, or empty string if there's no mistake", "y": percent from the top edge of the photo to the vertical center of the specific wrong token, "x": percent from the left edge of the photo to the horizontal position of the specific wrong token, "total_lines": total count of distinct handwritten lines visible in the photo counted top to bottom — INCLUDING crossed-out lines and the original problem line; a fraction (number over a bar over a number) counts as ONE line, "mistake_line_index": which of those lines (1-based from the top, same counting) contains the mistake, or 0 if has_mistake is false}

A light blue coordinate grid with percent labels is drawn over the photo purely to help you report positions: the numbers along the top edge are x percentages and the numbers along the left edge are y percentages. The grid is NOT part of the student's work — ignore it when reading the math. Read x and y directly off the nearest gridlines instead of estimating proportions by eye.

For x and y: point at the exact wrong token itself (e.g. the specific incorrect number or sign), not the start of the line and not the line's overall center — if the error is a number partway through or at the end of the line, x/y should land on that number, not on the beginning of the equation. Use this procedure: (1) find the mistake line in the photo and note where its writing starts and ends horizontally; (2) place the wrong token within the line by reading order — for example, if the line is "12x = 17" and the wrong token is the "17", that token sits AFTER the "=" sign near the right end of the written line, so x must be clearly to the right of the "=" — never over the "12x" at the start; (3) verify before answering: an imaginary circle centered at your (x, y) about a tenth of the image wide must contain the wrong token and must NOT contain the first characters of the line — if it fails, move x/y and re-verify. Look directly at the token's pixel position in the photo; do not estimate it from the line's position in a numbered sequence or assume lines are evenly spaced. The photo may be tilted, rotated, or taken at an angle — base x/y on the token's actual pixel position in the photo exactly as captured, not on where it would sit if the page were flattened and upright.`;

const QA_SYSTEM = 'You are a friendly, encouraging math teacher sitting next to a student, speaking directly to them. You already looked at their handwritten work and gave them feedback. Answer their follow-up question about that feedback in 2-4 plain spoken sentences, addressed to them as "you" throughout (e.g. "you subtracted instead of adding" or "your next step should be..."). Never refer to them in the third person — never say "the student" or "they". No markdown, no JSON, no code fences.\n\nIf the student directly asks you to just solve the problem, give the final answer, or do the work for them — rather than asking for a hint, a clarification, or an explanation of a mistake — go ahead and give them the actual solution clearly; don\'t refuse or lecture them about it. After your answer, on its own new line, write exactly "REVEALED_SOLUTION: true" if you just gave away the final answer or a full worked solution this way, or "REVEALED_SOLUTION: false" otherwise (e.g. you only explained a concept, clarified a mistake, or gave a hint without the answer).';

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

Before evaluating anything, check whether the photo's frame cuts off any part of the work — a line running off the bottom, top, left, or right edge, or too blurred/obscured to actually read in full. Treat any such line as unread: never guess, infer, or assume what it says or whether it's correct, even if the visible portion looks like an obvious continuation. Do not mention, evaluate, or count a cut-off line at all — treat the last fully visible and legible line as the actual end of the readable work so far.

Then, scan every line closely for a strikethrough, cross-out scribble, or diagonal/horizontal line drawn through it — a distinct visual mark on top of the handwriting, not just messy writing. It's easy to miss, especially on graph/grid paper where a thin line can blend into the grid, so look carefully at each line individually. Students often cross out a wrong step and rewrite the fix right next to or below it. Write down the exact text of every crossed-out line you find (there may be none) — you'll report this list and must check your answer against it before responding. Apply the same rule WITHIN lines to individual characters: a single digit, sign, or term with a scribble drawn over it has been deleted — read the line as if that token were not there, use any replacement written next to, above, or over the scribble in its place, and never interpret the scribble mark itself as a character or merge it into the term beside it.

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
- Write explanation and fix speaking directly TO the student as "you" (e.g. "you subtracted 37 instead of adding it"), the way a teacher would say it out loud sitting next to them. Never write in the third person — never say "the student" or "they".

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

// analyzeImage/checkWatch's max_tokens has been tuned twice in opposite
// directions and settled in the middle: 5000 was too tight and caused
// "no text response" failures on dense photos (thinking ran out before
// ever writing the JSON answer); 8000 fixed that but let a few genuinely
// complex photos run long enough to hit Vercel's 60s function ceiling
// (the Hobby plan's hard max — nothing to raise it against). 6500 is a
// deliberate middle ground, not a guess: still comfortably more headroom
// than the original 5000, while capping the worst case further from that
// 60s wall than 8000 did. If timeouts keep happening, the next lever is
// CHECK_OUTPUT_CONFIG's effort ("high" → "medium") or a Vercel Pro plan
// (300s ceiling) — not pushing max_tokens even higher on Hobby.

// Thinking tokens count against max_tokens, same budget as the final
// answer — "high" effort deliberately pushes the model toward MORE private
// reasoning, so a hard-to-read photo (dense work, several lines, a fraction
// or two) can burn through the whole budget before it ever writes the JSON
// answer, landing stop_reason "max_tokens" with a thinking block but no
// text block at all. That's what "The model did not return a text
// response" means when it happens — not a content refusal, a budget cutoff.
function requireTextBlock(data) {
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (textBlock) return textBlock;
  const detail = data.stop_reason === 'max_tokens'
    ? ' (ran out of thinking budget before answering — try a clearer or simpler photo)'
    : data.stop_reason ? ` (stop_reason: ${data.stop_reason})` : '';
  throw new Error(`The model did not return a text response${detail}.`);
}

// problemImage is optional: { base64, mediaType } for a photo of the
// printed problem (book/worksheet), shown to the model before the work
// photo so it can check against the actual problem statement instead of
// inferring it from the handwriting alone. problemText is the same idea
// but as already-transcribed plain text (e.g. from extractHomeworkProblems,
// read once at the start of a lesson rather than re-photographed at check
// time) — the two are independent and both optional. Omitted entirely when
// there's neither — the single-image request is byte-for-byte the same as
// before either of these existed.
function buildWorkContent(base64, mediaType, problemImage, problemText) {
  const content = [];
  if (problemText) {
    // Firm, not just informational: the student was ASSIGNED this exact
    // problem (homework queue), so the work must be judged as an attempt
    // at it — a live test showed internally-correct work for a completely
    // different problem sailing through as "Looks solid" when this was
    // phrased as passive context ("The problem the student is solving:").
    content.push({ type: 'text', text: `The student was assigned this specific problem to solve: ${problemText}

Judge the handwritten work strictly as an attempt at THIS assigned problem — never as standalone math. Before anything else, confirm the work actually addresses this exact problem. If the writing solves a clearly different problem instead, that IS the mistake, no matter how internally correct those steps are: report it as a mistake and tell the student plainly that what they wrote isn't the problem they were given, quoting the assigned problem so they know what to solve. For this wrong-problem case, anchor everything on the FIRST line of the student's written work: line_quote is that first line exactly as written, wrong_token is its first term, mistake_line_index is 1, and x/y point at that first written line's actual position in the photo — never at empty space, the desk, or objects around the paper.` });
  }
  if (problemImage && problemImage.base64) {
    content.push({ type: 'text', text: 'The next image is the PRINTED PROBLEM the student is solving, photographed from a book or worksheet — use it as the actual problem statement and target answer instead of inferring the problem from the handwriting alone.' });
    content.push({ type: 'image', source: { type: 'base64', media_type: problemImage.mediaType || 'image/jpeg', data: problemImage.base64 } });
    content.push({ type: 'text', text: 'The next image is the student\'s handwritten work solving that problem:' });
  }
  content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
  return content;
}

async function analyzeImage(base64, mediaType, problemImage, problemText) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 6500,
    thinking: CHECK_THINKING,
    output_config: CHECK_OUTPUT_CONFIG,
    system: 'You are a careful, encouraging math teacher. Respond with ONLY the JSON object requested — no markdown code fences, no commentary before or after it.',
    messages: [{
      role: 'user',
      content: [
        ...buildWorkContent(base64, mediaType, problemImage, problemText),
        { type: 'text', text: ANALYSIS_PROMPT },
      ],
    }],
  });
  return requireTextBlock(data).text;
}

async function checkWatch(base64, mediaType, priorState) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 6500,
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
  return requireTextBlock(data).text;
}

// Powers the "Give me a hint" button: reads the work in progress and
// nudges the student toward the next step without revealing it. Runs with
// the same thinking config as the checkers — a hint based on misread or
// unverified arithmetic is worse than no hint.
async function hintFromImage(base64, mediaType, problemImage, problemText) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 6000,
    thinking: CHECK_THINKING,
    output_config: CHECK_OUTPUT_CONFIG,
    system: 'You are a patient, encouraging math teacher sitting next to a student. Respond in plain text only — no markdown, no JSON, no code fences.',
    messages: [{
      role: 'user',
      content: [
        ...buildWorkContent(base64, mediaType, problemImage, problemText),
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
  return requireTextBlock(data).text.trim();
}

// Same "Give me a hint" purpose as hintFromImage, for a homework-queue
// problem the student hasn't started writing yet — nothing to read a
// photo of, so this only has the problem's transcribed text to go on. No
// thinking/verification needed here (there's no arithmetic to recompute
// yet), just pointing toward how to begin.
async function hintFromProblemText(problemText) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1000,
    system: 'You are a patient, encouraging math teacher sitting next to a student. Respond in plain text only — no markdown, no JSON, no code fences.',
    messages: [{
      role: 'user',
      content: `Here is the problem I'm about to solve: ${problemText}

I haven't written anything yet. Give me ONE hint to help me get started — point me toward the right first step or the key idea, without solving it for me or writing out any part of the actual solution.

Answer in 1-3 short, encouraging sentences spoken directly to me.`,
    }],
  });
  return requireTextBlock(data).text.trim();
}

// Powers the "Teach me & train on a subject" mode: a mini-lesson plus one
// practice problem the student solves by hand and then checks through the
// normal photo/watch flow. The frontend renders the reply in a handwriting
// font on ruled paper, so the system prompt asks for short hand-written
// lines rather than typed prose. No session state server-side — follow-ups
// resend the whole conversation, same pattern as /api/ask.
const TEACH_SYSTEM = `You are a friendly, encouraging math teacher writing by hand on a sheet of paper for one student. Respond in plain text only — no markdown, no code fences, no asterisks, no bullet symbols. Write the way you would on paper: short lines of at most about 45 characters (insert your own line breaks), one idea or one step per line, with a blank line between separate ideas.`;

// mode 'test_prep' reuses the exact same mini-lesson-plus-practice-problem
// mechanism as ordinary teaching, just framed as review/practice for an
// upcoming test rather than a first-time introduction to the topic — the
// underlying engine (this function, teachFollowup, the client's teach
// panel/thread UI) doesn't need to know or care which framing produced a
// given lesson.
async function teachSubject(subject, mode) {
  const testPrep = mode === 'test_prep';
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1200,
    system: TEACH_SYSTEM,
    messages: [{
      role: 'user',
      content: testPrep ? `The student has a test coming up on: "${subject}". Help them review and practice for it.

First give a short review: the core ideas they should remember for this, in a few plain sentences, plus a quick worked-example reminder if it helps — framed as review/practice for a test, not a first-time introduction.

Then present exactly ONE practice problem for them to solve by hand on paper, labelled "Problem:", pitched like something that could actually show up on the test. One problem only — they'll get another after this one is checked. Do not include the answer.

Close with one short sentence telling them to write their solution by hand and have Claruno check it.` : `Teach me this math topic: "${subject}".

First give a short mini-lesson: explain the core idea in a few plain sentences, then walk through one small worked example step by step, the way you'd scribble it on paper while sitting next to me.

Then present exactly ONE practice problem for me to solve by hand on paper, labelled "Problem:", matched to that topic at a typical school level. One problem only — I'll get another after this one is checked. Do not include the answer.

Close with one short sentence telling me to write my solution by hand and have Claruno check it.`,
    }],
  });
  return requireTextBlock(data).text.trim();
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
  return requireTextBlock(data).text.trim();
}

// Returns { text, revealed } — revealed is true when the student directly
// asked for the problem to be solved and the model complied (see the
// REVEALED_SOLUTION marker in QA_SYSTEM). The caller treats that the same
// as the student skipping the problem: nothing left to check on this one,
// so it moves straight to offering the next problem instead of Hint/Check.
async function askFollowup(conversation) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1000,
    system: QA_SYSTEM,
    messages: conversation,
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) return { text: "I couldn't come up with an answer to that — try rephrasing?", revealed: false };
  const raw = textBlock.text.trim();
  const match = raw.match(/\n?REVEALED_SOLUTION:\s*(true|false)\s*$/i);
  return {
    text: match ? raw.slice(0, match.index).trim() : raw,
    revealed: match ? match[1].toLowerCase() === 'true' : false,
  };
}

// Powers auto-rotation: runs each time the live camera comes up for a new
// capture (see autoDetectLessonCamRotation in index.html), so a camera
// mounted sideways or upside-down — or just a page turned differently on
// the desk — is corrected automatically instead of requiring a manual tap.
//
// Two earlier versions asked the model to reason abstractly about "how many
// degrees would this need to rotate" from a single photo — a forced guess
// was unreliable (confidently flipped upright work), and a reasoning-first
// version biased toward "0 if unsure" swung the other way and left
// genuinely rotated photos uncorrected on handwriting, where cues are weak.
// This version sidesteps that reasoning task entirely: `images` is all 4
// possible rotations of the same photo, already rotated client-side, and
// the model just has to pick which one looks upright — a direct visual
// comparison, much closer to how a person would actually solve this (try
// each way, see which looks right) than computing an angle from one image.
async function detectOrientation(images) {
  const letters = ['A', 'B', 'C', 'D'];
  const content = [
    { type: 'text', text: 'Here is the same photo of a handwritten math worksheet, shown 4 different ways — each rotated differently. Exactly one of them has the text/numbers upright and readable, left to right, top to bottom.' },
  ];
  images.forEach((img, i) => {
    content.push({ type: 'text', text: `Option ${letters[i]}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  });
  content.push({ type: 'text', text: 'Which option has the text upright and readable? Reason briefly (1-2 short sentences) about what you see, then end with a new line containing ONLY: "ANSWER: " followed by the letter (A, B, C, or D).' });

  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 200,
    system: 'You are judging which of four rotated versions of a photographed handwritten math worksheet is upright. Handwriting lacks the strong baseline/x-height cues of printed text, so compare the options directly rather than reasoning about angles: pick whichever one lets you actually read the digits, letters, and symbols normally — an equals sign (=) is two short horizontal strokes when upright, a fraction bar is horizontal with one number above and one below, and digits/letters have a consistent top and bottom that looks wrong when the wrong option is picked.',
    messages: [{ role: 'user', content }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  const match = textBlock && textBlock.text.match(/ANSWER:\s*([ABCD])/i);
  if (!match) return 0;
  const chosen = images[letters.indexOf(match[1].toUpperCase())];
  return chosen ? chosen.rotation : 0;
}

// Powers homework-queue driving: reads one or more photos of a student's
// UNSOLVED homework, taken at the start of a lesson, and transcribes each
// distinct problem as plain text so it can be presented back to the
// student one at a time. Deliberately asks for TRANSCRIPTION, not
// bounding boxes or cropped images — this session's auto-zoom work went
// through six rounds of asking a vision model for precise on-page
// coordinates and found it reliably imprecise at that, even when it
// correctly identified what/how many things were on the page. Reading and
// transcribing text is a task the model is already reliably good at
// (see analyzeImage reading a student's full solution for grading), so
// that's the only thing asked of it here. One photo can contain multiple
// problems (e.g. a full worksheet page), so results are a single flat
// list across ALL photos, in reading order.
async function extractHomeworkProblems(images, note) {
  const multi = images.length > 1;
  const content = [
    { type: 'text', text: `Here ${multi ? 'are photos' : 'is a photo'} of a student's homework page${multi ? 's' : ''} — printed or handwritten problems the student has NOT yet solved. Read through ${multi ? 'each photo' : 'it'} and transcribe every distinct problem as its own plain-text item, in reading order (top to bottom, left to right, across all photos in the order given). Skip anything that isn't itself a problem to solve — page headers, instructions, already-worked examples, page numbers.` },
  ];
  // The student's own note about which problems they were actually
  // assigned (a photographed page often has more exercises than the
  // homework calls for — "questions 2, 3, 6 and 7"). It only narrows or
  // annotates WHICH problems get transcribed; the transcription task
  // itself never changes.
  if (note) {
    content.push({ type: 'text', text: `The student added this note about their homework — use it to decide which problems from the page(s) to include (e.g. only specific question numbers), but ignore anything in it unrelated to selecting/reading the problems: "${note}"` });
  }
  images.forEach((img, i) => {
    if (multi) content.push({ type: 'text', text: `Photo ${i + 1}:` });
    content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.base64 } });
  });
  content.push({ type: 'text', text: 'Respond with ONLY this JSON shape, no markdown fences, no commentary: {"problems": ["full text of the first problem", "full text of the second problem", ...]}. Transcribe each problem\'s full text exactly as written/printed. Empty array if no legible unsolved problems are visible.' });

  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 2000,
    system: 'You are transcribing unsolved math problems from a photo of a student\'s homework page, so they can be presented back to the student one at a time. Respond with ONLY the JSON object requested, no markdown fences, no commentary.',
    messages: [{ role: 'user', content }],
  });
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) return [];
  try {
    const cleaned = textBlock.text.trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed.problems)) return [];
    return parsed.problems.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim());
  } catch (err) {
    return [];
  }
}

module.exports = { analyzeImage, askFollowup, checkWatch, hintFromImage, hintFromProblemText, teachSubject, teachFollowup, detectOrientation, extractHomeworkProblems, buildWatchPrompt, ANALYSIS_PROMPT, TOPICS };
