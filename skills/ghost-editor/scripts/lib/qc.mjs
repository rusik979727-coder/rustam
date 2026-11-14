import fs from 'node:fs';
import path from 'node:path';
import { probe, run } from './ffmpeg.mjs';
import { assWords } from './subs.mjs';
import { norm } from './transcript.mjs';
import { LOUDNESS } from './levels.mjs';

// QC = same checks on every video. FAIL blocks delivery, WARN is for the editor's eyes.
export async function qc(plan, outFile, { planWarnings = [] } = {}) {
  const res = [];
  const ok = (name, detail = '') => res.push({ level: 'PASS', name, detail });
  const warn = (name, detail) => res.push({ level: 'WARN', name, detail });
  const fail = (name, detail) => res.push({ level: 'FAIL', name, detail });
  const abs = path.resolve(plan.P, outFile);

  if (!fs.existsSync(abs)) {
    fail('output exists', outFile);
    return res;
  }
  const p = probe(abs);
  const { w, h, fps } = plan.format;

  // format
  if (p.video?.w === w && p.video?.h === h) ok('resolution', `${w}x${h}`);
  else fail('resolution', `got ${p.video?.w}x${p.video?.h}, want ${w}x${h}`);
  if (Math.abs((p.video?.fps || 0) - fps) < 0.05) ok('fps', String(fps));
  else fail('fps', `got ${p.video?.fps}, want ${fps}`);
  if (p.audio) ok('audio track', `${p.audio.rate} Hz, ${p.audio.channels} ch`);
  else fail('audio track', 'missing');
  const dd = Math.abs(p.duration - plan.duration);
  if (dd <= 0.15) ok('duration', `${p.duration.toFixed(2)}s (plan ${plan.duration}s)`);
  else fail('duration', `got ${p.duration.toFixed(2)}s, plan ${plan.duration}s`);

  // one pass over the file for loudness, black frames, silences, freezes
  const log = await run([
    '-i', abs,
    '-filter_complex', '[0:a]ebur128=peak=true,silencedetect=noise=-42dB:d=0.8[a];[0:v]blackdetect=d=0.25:pix_th=0.08,freezedetect=n=0.001:d=2[v]',
    '-map', '[a]', '-map', '[v]', '-f', 'null', '-',
  ], { label: 'qc scan', total: plan.duration });

  const summary = log.slice(log.lastIndexOf('Summary:'));
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
  if (Math.abs(I - LOUDNESS.I) <= LOUDNESS.toleranceLU) ok('loudness', `${I} LUFS (target ${LOUDNESS.I})`);
  else fail('loudness', `${I} LUFS, target ${LOUDNESS.I} ±${LOUDNESS.toleranceLU}`);
  if (TP <= LOUDNESS.maxTruePeak) ok('true peak', `${TP} dBTP`);
  else fail('true peak', `${TP} dBTP > ${LOUDNESS.maxTruePeak}`);

  const blacks = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(2)}–${(+m[2]).toFixed(2)}s`);
  if (blacks.length) fail('black frames', blacks.join(', '));
  else ok('black frames', 'none');
  const freezes = [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m) => `${(+m[1]).toFixed(2)}s`);
  if (freezes.length) warn('frozen picture ≥2s', freezes.join(', '));
  else ok('frozen picture', 'none');
  const sil = [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)]
    .map((m) => `${(+m[1]).toFixed(2)}–${(+m[2]).toFixed(2)}s`);
  if (sil.length) warn('dead air ≥0.8s (rhythm sags)', sil.join(', '));
  else ok('dead air', 'none');

  // on-screen text = only the speaker's words
  const assFile = path.join(plan.P, 'build/captions.ass');
  if (plan.captions.enabled && fs.existsSync(assFile)) {
    const said = new Set(plan.words.map((x) => norm(x.w)));
    const foreign = assWords(fs.readFileSync(assFile, 'utf8')).filter((x) => norm(x) && !said.has(norm(x)));
    if (foreign.length) fail('captions = spoken words only', `not spoken: ${foreign.slice(0, 10).join(' ')}`);
    else ok('captions = spoken words only', `${plan.words.length} words`);
  }

  // meme rule (already enforced by the plan; re-asserted on the resolved timeline)
  for (const b of plan.beats.filter((x) => x.meme)) {
    const mid = (b.climax[0] + b.climax[1]) / 2;
    if (b.meme.start + 1e-3 < mid) fail('meme after climax', `beats[${b.i}] meme at ${b.meme.start}s, climax mid ${mid}s`);
    else ok('meme after climax', `beats[${b.i}] meme @${b.meme.start}s (${b.meme.mode}), climax ${b.climax[0]}–${b.climax[1]}s`);
  }

  for (const w of planWarnings) warn('plan', w);
  return res;
}

export function printQc(res) {
  const icon = { PASS: '✓', WARN: '!', FAIL: '✗' };
  for (const r of res) console.log(`  ${icon[r.level]} ${r.level.padEnd(4)} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  const f = res.filter((r) => r.level === 'FAIL').length;
  const w = res.filter((r) => r.level === 'WARN').length;
  console.log(f ? `\nQC FAILED: ${f} fail, ${w} warn` : `\nQC PASSED (${w} warn)`);
  return f === 0;
}
