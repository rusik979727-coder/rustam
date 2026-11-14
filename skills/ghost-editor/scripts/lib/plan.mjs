import fs from 'node:fs';
import path from 'node:path';
import { loadTranscript } from './transcript.mjs';
import { SFX_GAIN_DB } from './levels.mjs';

// edit.json is the ONLY creative input: which takes, in what order, and where the beats are.
// Everything else (zoom curves, captions style, sfx levels, loudness) is fixed by the scripts.
// There is deliberately no field for free on-screen text: captions come from the speaker's words only.

const TOP_KEYS = new Set(['source', 'transcript', 'output', 'format', 'takes', 'beats', 'captions', 'notes']);
const TAKE_KEYS = new Set(['in', 'out', 'note']);
const BEAT_KEYS = new Set(['climax', 'zoom', 'sfx', 'meme', 'note']);
const MEME_KEYS = new Set(['file', 'at', 'dur']);
const FORMAT_KEYS = new Set(['w', 'h', 'fps']);
const CAPTION_KEYS = new Set(['maxWords', 'maxChars', 'position', 'uppercase', 'highlight', 'enabled']);

export const ZOOM = { rampIn: 0.14, rampOut: 0.28, lead: 0.06, tail: 0.25, max: 1.6 };
export const MEME = { defaultDur: 1.2, maxDur: 3.0, afterSlack: 0.5 };
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|mp4|mov|webm|mkv)$/i;
export const isVideoMeme = (f) => /\.(gif|mp4|mov|webm|mkv)$/i.test(f);

const r3 = (x) => Math.round(x * 1000) / 1000;

function checkKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) {
    if (!allowed.has(k)) {
      const hint = /text|title|label|caption|overlay|headline/i.test(k)
        ? ' (free on-screen text is not allowed: only words the speaker says appear on screen)'
        : '';
      errors.push(`${where}: unknown field "${k}"${hint}`);
    }
  }
}

export function loadPlan(P, S) {
  const planFile = path.join(P, 'edit.json');
  if (!fs.existsSync(planFile)) throw new Error(`no ${planFile} — run: node ${S}/scripts/build.mjs init ${P}`);
  const raw = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  const errors = [];
  const warnings = [];
  checkKeys(raw, TOP_KEYS, 'edit.json', errors);

  const plan = {
    P,
    source: raw.source,
    transcriptFile: raw.transcript || 'transcript.json',
    output: raw.output || 'out/final.mp4',
    format: { w: 1080, h: 1920, fps: 30, ...(raw.format || {}) },
    captions: { enabled: true, maxWords: 3, maxChars: 18, position: 0.7, uppercase: false, highlight: '#FFD400', ...(raw.captions || {}) },
    takes: [],
    beats: [],
    words: [],
    duration: 0,
  };
  if (raw.format) checkKeys(raw.format, FORMAT_KEYS, 'format', errors);
  if (raw.captions) checkKeys(raw.captions, CAPTION_KEYS, 'captions', errors);
  if (plan.format.w % 2 || plan.format.h % 2) errors.push('format: w and h must be even');

  if (!plan.source) errors.push('edit.json: "source" (the single input recording) is required');
  else if (!fs.existsSync(path.resolve(P, plan.source))) errors.push(`source not found: ${plan.source}`);

  // ---- takes -> output timeline
  if (!Array.isArray(raw.takes) || !raw.takes.length) errors.push('edit.json: "takes" must be a non-empty array');
  let t = 0;
  (raw.takes || []).forEach((tk, i) => {
    checkKeys(tk, TAKE_KEYS, `takes[${i}]`, errors);
    const a = Number(tk.in), b = Number(tk.out);
    if (!(Number.isFinite(a) && Number.isFinite(b) && b > a && a >= 0)) {
      errors.push(`takes[${i}]: need 0 <= in < out (got ${tk.in}..${tk.out})`);
      return;
    }
    if (b - a < 0.3) warnings.push(`takes[${i}]: very short take (${r3(b - a)}s)`);
    plan.takes.push({ i, in: a, out: b, dur: b - a, at: t, note: tk.note || '' });
    t += b - a;
  });
  plan.duration = r3(t);
  for (let i = 0; i < plan.takes.length; i++) {
    for (let j = i + 1; j < plan.takes.length; j++) {
      const A = plan.takes[i], B = plan.takes[j];
      if (A.in < B.out && B.in < A.out) errors.push(`takes[${A.i}] and takes[${B.i}] overlap in the source — the same words would play twice`);
    }
  }

  // ---- transcript -> kept words in output time
  const tf = path.resolve(P, plan.transcriptFile);
  if (!fs.existsSync(tf)) errors.push(`transcript not found: ${plan.transcriptFile} (run scripts/transcribe.py)`);
  else {
    const { words } = loadTranscript(tf);
    for (const tk of plan.takes) {
      for (const w of words) {
        const s = Math.max(w.s, tk.in), e = Math.min(w.e, tk.out);
        const len = Math.max(w.e - w.s, 0.001);
        if (e - s >= 0.5 * len || (w.s >= tk.in && w.s < tk.out && w.e - w.s < 0.02)) {
          plan.words.push({ w: w.w, s: r3(tk.at + (s - tk.in)), e: r3(tk.at + (e - tk.in)), take: tk.i, src: w.s });
        } else if (e > s) {
          warnings.push(`takes[${tk.i}] cuts through the word "${w.w}" @${w.s}s`);
        }
      }
    }
    plan.words.sort((a, b) => a.s - b.s);
  }

  // ---- beats
  (raw.beats || []).forEach((bt, i) => {
    const where = `beats[${i}]`;
    checkKeys(bt, BEAT_KEYS, where, errors);
    const [cs, ce] = (bt.climax || []).map(Number);
    if (!(Number.isFinite(cs) && Number.isFinite(ce) && ce > cs)) {
      errors.push(`${where}: "climax": [start, end] in source seconds is required`);
      return;
    }
    const tk = plan.takes.find((k) => cs >= k.in - 1e-6 && ce <= k.out + 1e-6);
    if (!tk) {
      errors.push(`${where}: climax ${cs}..${ce} is not fully inside a single take`);
      return;
    }
    const map = (x) => r3(tk.at + (x - tk.in));
    const beat = { i, take: tk, climax: [map(cs), map(ce)], src: [cs, ce], zoom: null, sfx: null, meme: null, note: bt.note || '' };

    if (bt.zoom != null) {
      const z = Number(bt.zoom);
      if (!(z >= 1 && z <= ZOOM.max)) errors.push(`${where}: zoom must be 1..${ZOOM.max}`);
      else if (z > 1) beat.zoom = z;
    }
    if (bt.sfx != null) {
      const f = String(bt.sfx);
      if (!SFX_GAIN_DB[f] && !fs.existsSync(path.resolve(P, f))) errors.push(`${where}: unknown sfx "${f}" (built-in: ${Object.keys(SFX_GAIN_DB).join(', ')}, or a file path in the project)`);
      beat.sfx = f;
    }
    if (bt.meme != null) {
      const m = typeof bt.meme === 'string' ? { file: bt.meme } : bt.meme;
      checkKeys(m, MEME_KEYS, `${where}.meme`, errors);
      if (!m.file || !MEDIA_EXT.test(m.file)) errors.push(`${where}.meme: "file" must be an image or video`);
      const at = m.at ?? 'center';
      const mid = (cs + ce) / 2;
      let srcAt;
      if (at === 'center') srcAt = mid;
      else if (at === 'after') srcAt = ce;
      else if (Number.isFinite(Number(at))) {
        srcAt = Number(at);
        // THE rule: a meme is a reaction. Centre of the climax or right after it — never before.
        if (srcAt < mid - 1e-6) errors.push(`${where}.meme: at=${at} is BEFORE the middle of the climax (${r3(mid)}). A meme is a reaction: use "center", "after", or a time >= ${r3(mid)}`);
        if (srcAt > ce + MEME.afterSlack) errors.push(`${where}.meme: at=${at} is too late (> climax end + ${MEME.afterSlack}s) — the reaction loses its punch`);
      } else errors.push(`${where}.meme: "at" must be "center", "after" or a source time`);
      const dur = Math.min(Number(m.dur ?? MEME.defaultDur), MEME.maxDur);
      if (!(dur > 0)) errors.push(`${where}.meme: bad dur`);
      if (srcAt != null) {
        // An "after" meme can sit slightly past the take end; clamp to timeline.
        const start = r3(tk.at + (Math.min(srcAt, tk.out) - tk.in));
        beat.meme = { file: m.file, start, end: r3(Math.min(start + dur, plan.duration)), mode: typeof at === 'string' ? at : 'time' };
      }
    }
    plan.beats.push(beat);
  });
  plan.beats.sort((a, b) => a.climax[0] - b.climax[0]);
  for (let i = 1; i < plan.beats.length; i++) {
    const a = plan.beats[i - 1], b = plan.beats[i];
    if (a.meme && b.meme && b.meme.start < a.meme.end) warnings.push(`beats[${a.i}] and beats[${b.i}]: memes overlap on screen`);
    if (b.climax[0] - a.climax[1] < 1.0) warnings.push(`beats[${a.i}] and beats[${b.i}] are < 1s apart — rhythm gets crowded`);
  }

  return { plan, errors, warnings };
}

// Zoom curve as an ffmpeg expression of output time T (seconds).
export function zoomExpr(plan, T = 'T') {
  const parts = plan.beats.filter((b) => b.zoom).map((b) => {
    const z = b.zoom - 1;
    const s = Math.max(0, b.climax[0] - ZOOM.lead - ZOOM.rampIn);
    const hEnd = Math.max(b.climax[1], b.meme ? b.meme.end - ZOOM.rampOut : 0) + ZOOM.tail;
    // smoothstep envelope: up over rampIn from s, hold, down over rampOut after hEnd
    const up = `clip((${T}-${r3(s)})/${ZOOM.rampIn},0,1)`;
    const dn = `clip((${r3(hEnd + ZOOM.rampOut)}-${T})/${ZOOM.rampOut},0,1)`;
    const env = `min(${up},${dn})`;
    return `${z}*(${env})*(${env})*(3-2*(${env}))`;
  });
  if (!parts.length) return null;
  return parts.reduce((acc, p) => `max(${acc},${p})`);
}
