// ElevenLabs text-to-speech, shared by the Vercel and Netlify handlers.
// Returns base64 MP3, or null when not configured / on any failure — the
// client treats null as "use the browser's built-in voice instead", so
// narration keeps working before the API key is set up and degrades
// gracefully if the service ever hiccups.

// "Jessica" — a conversational, expressive premade voice; the previous
// default ("Rachel") read like a news announcer. Overridable via env for
// trying other voices without a code change — any voice ID from the
// ElevenLabs voice library works.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'cgSgspJ2msm6clMCkdW9';

// Most-human first: eleven_v3 is ElevenLabs' most expressive model; if
// the account/model rejects the request, fall back to multilingual_v2
// with deliberately LOW stability + some style — high stability is what
// made the first version sound flat and synthetic. Both handle
// non-English text (e.g. Hebrew). ELEVENLABS_MODEL_ID pins a single
// model instead.
const MODEL_ATTEMPTS = process.env.ELEVENLABS_MODEL_ID
  ? [{ model_id: process.env.ELEVENLABS_MODEL_ID, voice_settings: { stability: 0.5 } }]
  : [
      { model_id: 'eleven_v3', voice_settings: { stability: 0.5 } },
      { model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.4, use_speaker_boost: true } },
    ];

async function synthesizeSpeech(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  for (const attempt of MODEL_ATTEMPTS) {
    try {
      // 64kbps mono MP3 — plenty for short spoken lines, small payload.
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: attempt.model_id,
          voice_settings: attempt.voice_settings,
        }),
      });
      if (res.ok) return Buffer.from(await res.arrayBuffer()).toString('base64');
    } catch (err) { /* try the next model */ }
  }
  return null;
}

module.exports = { synthesizeSpeech };
