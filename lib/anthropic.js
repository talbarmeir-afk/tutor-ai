// Shared Anthropic API logic used by both the Vercel (api/) and Netlify
// (netlify/functions/) handlers, so the request/response shaping only
// needs to be written once per platform, not the model-calling logic.

const ANTHROPIC_VERSION = '2023-06-01';
const MODEL = 'claude-opus-4-8';

const ANALYSIS_PROMPT = `Look at this photo of handwritten math work. Read it from top to bottom as the student's solution to one problem, treating each distinct equation or step as one "line" (ignore blank space between them).

Find the first line where the student makes a mathematical error (an incorrect step, wrong sign, dropped term, arithmetic slip, etc). If the whole solution is correct, note that instead.

Respond with ONLY this JSON object, no markdown fences, no extra text:
{"has_mistake": true or false, "line_quote": "short exact snippet of text/expression from that line", "explanation": "1-2 plain sentences on what's wrong", "fix": "one sentence on the correct step, or empty string if there's no mistake", "total_lines": number of distinct written lines/steps in the photo, "mistake_line_number": 1-based position of the flagged line counting from the top (use the last line if has_mistake is false), "first_line_y": percent from the top edge of the photo to the vertical center of the FIRST written line, "last_line_y": percent from the top edge of the photo to the vertical center of the LAST written line, "x": percent from the left edge of the photo to roughly where the flagged line sits horizontally}

Take care with first_line_y and last_line_y — every other line's position gets calculated from those two anchors, so estimate them precisely rather than the individual flagged line.`;

const QA_SYSTEM = 'You are a friendly, encouraging math teacher. You already reviewed this student\'s handwritten work and gave feedback. Answer their follow-up question about that feedback in 2-4 plain spoken sentences. No markdown, no JSON, no code fences — just talk to them directly.';

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

module.exports = { analyzeImage, askFollowup, ANALYSIS_PROMPT };
