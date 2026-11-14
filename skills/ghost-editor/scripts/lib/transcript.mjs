import fs from 'node:fs';

// Normalised transcript: { words: [{ w, s, e }] } in SOURCE seconds.
// Accepts our own format, whisper / faster-whisper JSON (segments[].words[]),
// or a flat array of {word|text|w, start|s, end|e}.
export function loadTranscript(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  let list;
  if (Array.isArray(raw)) list = raw;
  else if (Array.isArray(raw.words)) list = raw.words;
  else if (Array.isArray(raw.segments)) list = raw.segments.flatMap((s) => s.words || []);
  else throw new Error(`${file}: unknown transcript format (expected words[] or segments[].words[])`);

  const words = list
    .map((x) => ({
      w: String(x.w ?? x.word ?? x.text ?? '').trim(),
      s: Number(x.s ?? x.start),
      e: Number(x.e ?? x.end),
    }))
    .filter((x) => x.w && Number.isFinite(x.s) && Number.isFinite(x.e));
  if (!words.length) throw new Error(`${file}: transcript has no timed words`);
  words.sort((a, b) => a.s - b.s);
  for (const x of words) if (x.e < x.s) x.e = x.s;
  return { words };
}

// Strip punctuation for comparisons ("Привет," == "привет").
export const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
