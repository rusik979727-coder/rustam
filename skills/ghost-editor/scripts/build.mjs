#!/usr/bin/env node
// ghost-editor: one recording in, one video out.
//   node build.mjs init  <P> [--source raw.mp4]   create edit.json skeleton + assets
//   node build.mjs view  <P>                      transcript as phrases with timecodes (for choosing takes)
//   node build.mjs check <P>                      validate edit.json only
//   node build.mjs       <P>                      build: assets → captions → render → QC → preview
//   node build.mjs qc    <P>                      QC an existing render
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlan } from './lib/plan.mjs';
import { buildAss } from './lib/subs.mjs';
import { render, sfxEvents } from './lib/render.mjs';
import { qc, printQc } from './lib/qc.mjs';
import { viewTranscript } from './lib/view.mjs';
import { previewHtml } from './lib/preview.mjs';
import { SFX_GAIN_DB } from './lib/levels.mjs';

const S = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const CMDS = new Set(['init', 'view', 'check', 'build', 'qc']);
const cmd = CMDS.has(argv[0]) ? argv.shift() : 'build';
const P = path.resolve(argv.find((a) => !a.startsWith('--')) || '.');
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };

const die = (msg) => { console.error(`ghost-editor: ${msg}`); process.exit(1); };

function copyIfChanged(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const a = fs.statSync(from);
  if (fs.existsSync(to)) {
    const b = fs.statSync(to);
    if (b.size === a.size && b.mtimeMs >= a.mtimeMs) return false;
  }
  fs.copyFileSync(from, to);
  return true;
}

// Copy what the project needs from $S/assets into $P/assets so $P is self-contained
// (render, preview.html and any later rebuild work from the project folder alone).
function syncAssets(plan) {
  const copied = [];
  const fontDir = path.join(S, 'assets/fonts');
  for (const f of fs.readdirSync(fontDir)) if (copyIfChanged(path.join(fontDir, f), path.join(P, 'assets/fonts', f))) copied.push(`fonts/${f}`);
  for (const e of sfxEvents(plan)) {
    if (SFX_GAIN_DB[e.name] == null) continue;
    if (copyIfChanged(path.join(S, 'assets/sfx', `${e.name}.wav`), path.join(P, 'assets/sfx', `${e.name}.wav`))) copied.push(`sfx/${e.name}.wav`);
  }
  for (const b of plan.beats.filter((x) => x.meme)) {
    const m = b.meme;
    if (fs.existsSync(path.resolve(P, m.file))) continue;
    const lib = [path.join(S, 'assets/memes', m.file), path.join(S, 'assets', m.file)].find((f) => fs.existsSync(f));
    if (!lib) die(`beats[${b.i}].meme: file not found in project or ${S}/assets/memes: ${m.file}`);
    const rel = path.join('assets/memes', path.basename(lib));
    if (copyIfChanged(lib, path.join(P, rel))) copied.push(rel.replace(/^assets\//, ''));
    m.file = rel;
  }
  return copied;
}

function load() {
  const { plan, errors, warnings } = loadPlan(P, S);
  for (const w of warnings) console.log(`  ! ${w}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ✗ ${e}`);
    die(`edit.json has ${errors.length} error(s)`);
  }
  return { plan, warnings };
}

function summary(plan) {
  console.log(`  ${plan.takes.length} takes → ${plan.duration}s, ${plan.beats.length} beats, ${plan.beats.filter((b) => b.meme).length} memes, ${plan.words.length} caption words, ${plan.format.w}x${plan.format.h}@${plan.format.fps}`);
}

if (cmd === 'init') {
  fs.mkdirSync(P, { recursive: true });
  const ef = path.join(P, 'edit.json');
  if (fs.existsSync(ef)) die(`${ef} already exists`);
  const tpl = JSON.parse(fs.readFileSync(path.join(S, 'templates/edit.json'), 'utf8'));
  const src = opt('source') || fs.readdirSync(P).find((f) => /\.(mp4|mov|mkv|webm|m4v)$/i.test(f));
  if (src) tpl.source = src;
  fs.writeFileSync(ef, JSON.stringify(tpl, null, 2) + '\n');
  for (const f of fs.readdirSync(path.join(S, 'assets/fonts'))) copyIfChanged(path.join(S, 'assets/fonts', f), path.join(P, 'assets/fonts', f));
  console.log(`created ${ef}${src ? ` (source: ${src})` : ' — set "source"'}`);
  if (!fs.existsSync(path.join(P, 'transcript.json'))) console.log(`next: python3 ${S}/scripts/transcribe.py ${P}/${src || '<source>'}`);
  process.exit(0);
}

if (cmd === 'view') {
  let tf = path.join(P, 'transcript.json');
  try { tf = path.resolve(P, JSON.parse(fs.readFileSync(path.join(P, 'edit.json'), 'utf8')).transcript || 'transcript.json'); } catch {}
  if (!fs.existsSync(tf)) die(`no transcript at ${tf}`);
  console.log(viewTranscript(tf, { pause: Number(opt('pause') || 0.6) }));
  process.exit(0);
}

if (cmd === 'check') {
  const { plan } = load();
  summary(plan);
  console.log('  edit.json OK');
  process.exit(0);
}

const { plan, warnings } = load();
summary(plan);
const outFile = plan.output;

if (cmd === 'build') {
  const copied = syncAssets(plan);
  if (copied.length) console.log(`  assets → ${P}/assets: ${copied.join(', ')}`);
  fs.mkdirSync(path.join(P, 'build'), { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(P, outFile)), { recursive: true });
  if (plan.captions.enabled) fs.writeFileSync(path.join(P, 'build/captions.ass'), buildAss(plan));
  fs.writeFileSync(path.join(P, 'build/timeline.json'), JSON.stringify({
    duration: plan.duration, takes: plan.takes, beats: plan.beats.map(({ take, ...b }) => b), sfx: sfxEvents(plan), words: plan.words,
  }, null, 2));
  const t0 = Date.now();
  await render(plan, outFile).catch((e) => die(e.message));
  console.log(`  rendered ${outFile} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} else {
  for (const b of plan.beats.filter((x) => x.meme)) {
    if (!fs.existsSync(path.resolve(P, b.meme.file))) b.meme.file = path.join('assets/memes', path.basename(b.meme.file));
  }
}

console.log('\nQC');
const res = await qc(plan, outFile, { planWarnings: warnings });
fs.writeFileSync(path.join(P, 'build/qc.json'), JSON.stringify(res, null, 2));
fs.writeFileSync(path.join(P, 'preview.html'), previewHtml(plan, res));
const passed = printQc(res);
console.log(`\n  output:  ${path.resolve(P, outFile)}\n  preview: ${path.join(P, 'preview.html')}`);
process.exit(passed ? 0 : 2);
