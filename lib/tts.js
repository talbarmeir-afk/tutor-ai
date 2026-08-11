// ElevenLabs text-to-speech, shared by the Vercel and Netlify handlers.
// Returns base64 MP3, or null when not configured / on any failure — the
// client treats null as "use the browser's built-in voice instead", so
// narration keeps working before the API key is set up and degrades
// gracefully if the service ever hiccups.

// "Kayla" from the ElevenLabs Voice Library — the user auditioned and
// picked this one (ID copied from their own account, so it matches their
// added copy). NOTE: library voices must be added to the account's My
// Voices before the API can use them. Overridable via env without a code
// change; a mismatched/unadded ID makes every attempt fail and narration
// falls back to the browser voice — the tell is the robotic voice
// returning.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'sWsBiVcjjowceAScTnu3';

// Most-human first: eleven_v3 is ElevenLabs' most expressive model; if
// the account/model rejects the request, fall back to multilingual_v2
// with deliberately LOW stability + some style — high stability is what
// made the first version sound flat and synthetic. Both handle
// non-English text (e.g. Hebrew). ELEVENLABS_MODEL_ID pins a single
// model instead.
// expressive: true attempts may prepend a v3 audio tag (a bracketed
// delivery direction v3 interprets as tone rather than words) — never
// sent to v2, which would read it out loud.
const MODEL_ATTEMPTS = process.env.ELEVENLABS_MODEL_ID
  ? [{ model_id: process.env.ELEVENLABS_MODEL_ID, voice_settings: { stability: 0.5 } }]
  : [
      { model_id: 'eleven_v3', voice_settings: { stability: 0.5 }, expressive: true },
      { model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true } },
    ];

// Returns { audio, model } ({ audio: null } when unconfigured/failing) —
// the model field says which attempt actually served, since a silent
// fallback to the older model is indistinguishable by ear from "v3 just
// isn't very good", and that distinction decides what to fix next.
async function synthesizeSpeech(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return { audio: null };
  for (const attempt of MODEL_ATTEMPTS) {
    try {
      // 64kbps mono MP3 — plenty for short spoken lines, small payload.
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: attempt.expressive ? `[warmly] ${text}` : text,
          model_id: attempt.model_id,
          voice_settings: attempt.voice_settings,
        }),
      });
      if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()).toString('base64'), model: attempt.model_id };
    } catch (err) { /* try the next model */ }
  }
  return { audio: null };
}

module.exports = { synthesizeSpeech };
