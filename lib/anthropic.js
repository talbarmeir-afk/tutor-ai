// Shared Anthropic API logic used by both the Vercel (api/) and Netlify
// (netlify/functions/) handlers, so the request/response shaping only
// needs to be written once per platform, not the model-calling logic.

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-8';

const ANALYSIS_PROMPT = `Look at this photo of handwritten math work. Read it from top to bottom as the student's solution to one problem, treating each distinct equation or step as one "line" (ignore blank space between them).

Find the first line where the student makes a mathematical error (an incorrect step, wrong sign, dropped term, arithmetic slip, etc), and identify the specific wrong token within that line — the particular number, sign, or term that is actually incorrect (not just the line as a whole). If the whole solution is correct, note that instead (point at the last written line).

Respond with ONLY this JSON object, no markdown fences, no extra text:
{"has_mistake": true or false, "line_quote": "short exact snippet of text/expression from that line", "explanation": "1-2 plain sentences on what's wrong", "fix": "one sentence on the correct step, or empty string if there's no mistake", "y": percent from the top edge of the photo to the vertical center of the specific wrong token, "x": percent from the left edge of the photo to the horizontal position of the specific wrong token}

For x and y: point at the exact wrong token itself (e.g. the specific incorrect number or sign), not the start of the line and not the line's overall center — if the error is a number partway through or at the end of the line, x/y should land on that number, not on the beginning of the equation. Look directly at that token's pixel position in the photo; do not estimate it from the line's position in a numbered sequence or assume lines are evenly spaced. The photo may be tilted, rotated, or taken at an angle — base x/y on the token's actual pixel position in the photo exactly as captured, not on where it would sit if the page were flattened and upright.`;

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

Now look at the current photo and report on the CURRENT state of the work:
- For every new line since the last reviewed point, actually recompute the arithmetic yourself step by step rather than skimming and assuming it looks plausible — this is the most common way real mistakes get missed, especially on simple steps like isolating a variable (e.g. going from "2a = 6" to "a = 2" instead of "a = 3").
- If there is a previously-flagged mistake and it is still present uncorrected, has_mistake should be true, mistake_resolved should be false, and the mistake fields should describe that same original mistake.
- If a previously-flagged mistake has been corrected, set mistake_resolved to true. Then also check whether the work continues correctly after that fix, or whether a new mistake exists further down — if so has_mistake should be true describing that new mistake; otherwise has_mistake should be false.
- If there was no pending mistake, check only the content written since the last reviewed line: if it's all correct so far, has_mistake should be false; if there's a mistake in it, has_mistake should be true.
- Either way, set reviewed_through to a short exact snippet of the last written line that is now confirmed fully correct (the line immediately before any currently-unresolved mistake, or the last written line if everything so far is correct).

Respond with ONLY this JSON object, no markdown fences, no extra text:
{"has_mistake": true or false, "mistake_resolved": true or false, "line_quote": "short exact snippet of text/expression from the current mistake line, or empty string if has_mistake is false", "explanation": "1-2 plain sentences on what's wrong, or empty string if has_mistake is false", "fix": "one sentence on the correct step, or empty string if has_mistake is false", "y": percent from the top edge of the photo to the vertical center of the specific wrong token (or 50 if has_mistake is false), "x": percent from the left edge of the photo to the horizontal position of the specific wrong token (or 50 if has_mistake is false), "reviewed_through": "short exact snippet of the last confirmed-correct written line, or empty string if nothing is confirmed correct yet"}

For x and y (only when has_mistake is true): point at the exact wrong token itself — the specific incorrect number, sign, or term — not the start of the line. The photo may be tilted, rotated, or taken at an angle — base x/y on the token's actual pixel position in the photo exactly as captured, not on where it would sit if the page were flattened and upright.`;
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

async function analyzeImage(base64, mediaType) {
  const data = await callAnthropic({
    model: MODEL,
    max_tokens: 1000,
    system: 'You are a careful, encouraging math teacher. Respond with ONLY the JSON object requested — no markdown code fences, no commentary before or after it.',
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
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
    max_tokens: 1000,
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

module.exports = { analyzeImage, askFollowup, checkWatch, buildWatchPrompt, ANALYSIS_PROMPT };
