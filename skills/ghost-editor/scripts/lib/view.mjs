import { loadTranscript, norm } from './transcript.mjs';

// Prints the raw recording as phrases with source timecodes, so takes can be chosen.
// Phrases split on pauses; phrases that start like a later one are flagged as probable retakes.
export function viewTranscript(file, { pause = 0.6 } = {}) {
  const { words } = loadTranscript(file);
  const phrases = [];
  let cur = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.s - prev.e >= pause) { phrases.push(cur); cur = []; }
    cur.push(w);
  }
  if (cur.length) phrases.push(cur);

  const key = (p) => p.slice(0, 3).map((x) => norm(x.w)).join(' ');
  const out = [];
  phrases.forEach((p, i) => {
    const k = key(p);
    const later = phrases.findIndex((q, j) => j > i && p.length >= 2 && key(q) === k);
    const gap = i ? (p[0].s - phrases[i - 1].at(-1).e).toFixed(2) : '0.00';
    const flag = later >= 0 ? `   ⟲ retake? same start as #${later + 1}` : '';
    out.push(`#${String(i + 1).padStart(3)}  ${p[0].s.toFixed(2).padStart(7)} → ${p.at(-1).e.toFixed(2).padStart(7)}  (pause ${gap}s)${flag}\n      ${p.map((x) => x.w).join(' ')}`);
  });
  return out.join('\n');
}
