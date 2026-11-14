import path from 'node:path';
import { zoomExpr, isVideoMeme } from './plan.mjs';
import { SFX_GAIN_DB, DEFAULT_SFX_GAIN_DB, MEME_AUDIO_GAIN_DB, VOICE_GAIN_DB, AUTO_SFX, SFX_HIT, LOUDNESS } from './levels.mjs';
import { probe, run } from './ffmpeg.mjs';

const r3 = (x) => Math.round(x * 1000) / 1000;
const AFMT = 'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo';

// Every SFX event in output time. Derived from beats with fixed rules.
export function sfxEvents(plan) {
  const ev = [];
  const add = (name, hitAt, why) => {
    const builtin = SFX_GAIN_DB[name] != null;
    const file = builtin ? `assets/sfx/${name}.wav` : name;
    const at = Math.max(0, hitAt - (SFX_HIT[name] ?? 0));
    ev.push({ name, file, at: r3(at), gain: builtin ? SFX_GAIN_DB[name] : DEFAULT_SFX_GAIN_DB, why });
  };
  for (const b of plan.beats) {
    if (b.zoom) add(AUTO_SFX.zoomIn, b.climax[0] - 0.06, `beats[${b.i}] zoom`);
    if (b.sfx) add(b.sfx, b.climax[0], `beats[${b.i}] sfx`);
    if (b.meme) add(AUTO_SFX.meme, b.meme.start, `beats[${b.i}] meme`);
  }
  return ev.sort((a, b) => a.at - b.at);
}

// Builds inputs + filter graph. audioOnly=true is used for the loudness measuring pass.
function graph(plan, { audioOnly = false, loud = null } = {}) {
  const { w: W, h: H, fps } = plan.format;
  const inputs = ['-i', plan.source];
  const f = [];
  let idx = 1;

  // 1) cuts: trim each take, tiny audio fades so cuts never click
  const N = plan.takes.length;
  plan.takes.forEach((t, k) => {
    if (!audioOnly) f.push(`[0:v]trim=start=${t.in}:end=${t.out},setpts=PTS-STARTPTS[v${k}]`);
    const fo = Math.max(0, t.dur - 0.015);
    f.push(`[0:a]atrim=start=${t.in}:end=${t.out},asetpts=PTS-STARTPTS,${AFMT},afade=t=in:d=0.012,afade=t=out:st=${r3(fo)}:d=0.015[a${k}]`);
  });
  if (audioOnly) f.push(`${plan.takes.map((_, k) => `[a${k}]`).join('')}concat=n=${N}:v=0:a=1[voice0]`);
  else f.push(`${plan.takes.map((_, k) => `[v${k}][a${k}]`).join('')}concat=n=${N}:v=1:a=1[vc][voice0]`);

  // 2) video: fill frame, zoom animation, memes, captions
  if (!audioOnly) {
    f.push(`[vc]fps=${fps},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1[vb]`);
    let cur = 'vb';
    const z = zoomExpr(plan, `(on/${fps})`);
    if (z) {
      f.push(`[vb]scale=${W * 2}:${H * 2}:flags=lanczos,zoompan=z='1+${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${fps}[vz]`);
      cur = 'vz';
    }
    plan.beats.filter((b) => b.meme).forEach((b, k) => {
      const m = b.meme;
      const dur = r3(m.end - m.start);
      if (isVideoMeme(m.file)) inputs.push('-t', String(dur), ...(/\.gif$/i.test(m.file) ? ['-ignore_loop', '0'] : []), '-i', m.file);
      else inputs.push('-loop', '1', '-framerate', String(fps), '-t', String(dur), '-i', m.file);
      m.input = idx++;
      f.push(`[${m.input}:v]fps=${fps},scale=${Math.round(W * 0.8)}:${Math.round(H * 0.42)}:force_original_aspect_ratio=decrease:flags=lanczos,format=rgba,` +
        `fade=t=in:st=0:d=0.08:alpha=1,fade=t=out:st=${r3(Math.max(0, dur - 0.12))}:d=0.12:alpha=1,setpts=PTS-STARTPTS+${m.start}/TB[m${k}]`);
      f.push(`[${cur}][m${k}]overlay=x=(W-w)/2:y=H*0.14:enable='between(t,${m.start},${m.end})':eof_action=pass[vm${k}]`);
      cur = `vm${k}`;
    });
    if (plan.captions.enabled && plan.words.length) {
      f.push(`[${cur}]ass=build/captions.ass:fontsdir=assets/fonts[vs]`);
      cur = 'vs';
    }
    f.push(`[${cur}]format=yuv420p[vout]`);
  } else {
    // keep input indices identical between passes
    plan.beats.filter((b) => b.meme).forEach((b) => {
      const m = b.meme;
      const dur = r3(m.end - m.start);
      inputs.push('-t', String(dur), '-i', m.file);
      m.input = idx++;
    });
  }

  // 3) audio: voice + sfx at fixed levels + meme audio, then loudness
  const mix = [];
  f.push(`[voice0]volume=${VOICE_GAIN_DB}dB[voice]`);
  mix.push('[voice]');
  sfxEvents(plan).forEach((e, k) => {
    inputs.push('-i', e.file);
    const ms = Math.round(e.at * 1000);
    f.push(`[${idx}:a]${AFMT},volume=${e.gain}dB,adelay=${ms}:all=1[s${k}]`);
    mix.push(`[s${k}]`);
    idx++;
  });
  plan.beats.filter((b) => b.meme && b.meme.hasAudio).forEach((b, k) => {
    const ms = Math.round(b.meme.start * 1000);
    f.push(`[${b.meme.input}:a]${AFMT},volume=${MEME_AUDIO_GAIN_DB}dB,afade=t=out:st=${r3(Math.max(0, b.meme.end - b.meme.start - 0.15))}:d=0.15,adelay=${ms}:all=1[ma${k}]`);
    mix.push(`[ma${k}]`);
  });
  const mixed = mix.length > 1 ? `${mix.join('')}amix=inputs=${mix.length}:normalize=0:duration=first:dropout_transition=0` : `${mix[0]}anull`;
  const ln = `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`;
  if (!loud) f.push(`${mixed},${ln}:print_format=json[aout]`);
  else f.push(`${mixed},${ln}:measured_I=${loud.input_i}:measured_TP=${loud.input_tp}:measured_LRA=${loud.input_lra}:measured_thresh=${loud.input_thresh}:offset=${loud.target_offset}:linear=true,aresample=48000[aout]`);

  return { inputs, filter: f.join(';\n') };
}

export async function render(plan, outFile) {
  const src = probe(path.resolve(plan.P, plan.source));
  if (!src.audio) throw new Error('source has no audio track');
  if (!src.video) throw new Error('source has no video track');
  for (const b of plan.beats) if (b.meme) b.meme.hasAudio = isVideoMeme(b.meme.file) && !/\.gif$/i.test(b.meme.file) && !!probe(path.resolve(plan.P, b.meme.file)).audio;

  // pass 1: measure loudness of the final mix
  const g1 = graph(plan, { audioOnly: true });
  const log = await run([...g1.inputs, '-filter_complex', g1.filter, '-map', '[aout]', '-f', 'null', '-'], { cwd: plan.P, label: 'loudness pass', total: plan.duration });
  const j = log.slice(log.lastIndexOf('{'), log.lastIndexOf('}') + 1);
  const loud = JSON.parse(j);

  // pass 2: render
  const g2 = graph(plan, { loud });
  await run([
    ...g2.inputs, '-filter_complex', g2.filter,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(plan.format.fps),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(plan.duration), '-movflags', '+faststart', outFile,
  ], { cwd: plan.P, label: 'render', total: plan.duration });
  return { loudIn: loud };
}

export { graph as _graph };
