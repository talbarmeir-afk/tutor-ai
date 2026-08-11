// ElevenLabs text-to-speech, shared by the Vercel and Netlify handlers.
// Returns base64 MP3, or null when not configured / on any failure — the
// client treats null as "use the browser's built-in voice instead", so
// narration keeps working before the API key is set up and degrades
// gracefully if the service ever hiccups.

// "Rachel" — ElevenLabs' warm, friendly premade voice. Overridable via
// env for trying other voices without a code change.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

async function synthesizeSpeech(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  try {
    // 64kbps mono MP3 — plenty for short spoken lines, small payload.
    // eleven_multilingual_v2 handles non-English text (e.g. Hebrew) too.
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_64`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  } catch (err) {
    return null;
  }
}

module.exports = { synthesizeSpeech };
