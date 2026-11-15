// Offline music + SFX for the hernia film. All times are video seconds (90 BPM, bar = 2.6667 s).
'use strict';
window.buildAudio = async function () {
  const SR = 48000, DURA = 1600 / 60, B = 60 / 90, BARL = B * 4;
  const ctx = new OfflineAudioContext(2, Math.round(SR * DURA), SR);
  const rnd = (() => { let a = 1234; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // master chain
  const master = ctx.createGain(); master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.25;
  master.connect(comp); comp.connect(ctx.destination);
  master.gain.setValueAtTime(0.9, 25.6); master.gain.linearRampToValueAtTime(0.0, DURA - 0.02);
  // reverb
  const ir = ctx.createBuffer(2, SR * 3.2, SR);
  for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = i / SR; d[i] = (rnd() * 2 - 1) * Math.pow(1 - x / 3.2, 2.2) * Math.exp(-x * 1.1); } }
  const verb = ctx.createConvolver(); verb.buffer = ir; const verbG = ctx.createGain(); verbG.gain.value = 0.42; verb.connect(verbG); verbG.connect(master);
  const bus = (dry = 1, wet = .3, pan = 0) => { const g = ctx.createGain(); g.gain.value = 1; const p = ctx.createStereoPanner(); p.pan.value = pan; const d = ctx.createGain(); d.gain.value = dry; const w = ctx.createGain(); w.gain.value = wet; g.connect(p); p.connect(d); d.connect(master); p.connect(w); w.connect(verb); return g; };
  const noiseBuf = (() => { const b = ctx.createBuffer(1, SR * 4, SR); const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1; return b; })();
  const noise = (t0, dur, out) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.connect(out); s.start(t0, rnd() * 3); s.stop(t0 + dur + .05); return s; };

  // ---------- music ----------
  const CH = { Dm: [50, 57, 62, 65, 69], Bb: [46, 53, 58, 62, 65], F: [53, 57, 60, 65, 69], Gm: [43, 50, 55, 58, 62], A: [45, 52, 57, 61, 64], Dm9: [50, 57, 62, 64, 65, 69] };
  const PROG = ['Dm', 'Dm', 'Bb', 'F', 'Gm', 'Gm', 'Bb', 'A', 'Dm9', 'Dm9'];
  const ROOTN = { Dm: 38, Bb: 34, F: 41, Gm: 31, A: 33, Dm9: 38 };
  const padBus = bus(.55, .55);
  PROG.forEach((name, bi) => {
    const t0 = bi * BARL, t1 = t0 + BARL;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = .6;
    const open = [500, 650, 800, 900, 900, 1300, 1500, 1900, 1000, 800][bi];
    lp.frequency.setValueAtTime(open * .7, t0); lp.frequency.linearRampToValueAtTime(open, t0 + BARL * .6); lp.frequency.linearRampToValueAtTime(open * .8, t1 + .6);
    const g = ctx.createGain(); const lvl = [.05, .06, .065, .065, .07, .075, .08, .085, .075, .06][bi];
    g.gain.setValueAtTime(0, Math.max(0, t0 - .25)); g.gain.linearRampToValueAtTime(lvl, t0 + .5); g.gain.setValueAtTime(lvl, t1 - .3); g.gain.linearRampToValueAtTime(0, t1 + .8);
    lp.connect(g); g.connect(padBus);
    CH[name].forEach((m, j) => { for (const det of [-7, 6]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det + (j - 2) * 1.5; const og = ctx.createGain(); og.gain.value = .22; o.connect(og); og.connect(lp); o.start(Math.max(0, t0 - .3)); o.stop(t1 + 1); } });
    // bass (from bar 2)
    if (bi >= 1) { const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(ROOTN[name]); const bg = ctx.createGain(); const bl = bi >= 5 && bi <= 7 ? .2 : .14;
      bg.gain.setValueAtTime(0, t0); bg.gain.linearRampToValueAtTime(bl, t0 + .08); bg.gain.setValueAtTime(bl, t1 - .15); bg.gain.linearRampToValueAtTime(0, t1 + .05);
      const bb = bus(1, .05); o.connect(bg); bg.connect(bb); o.start(t0); o.stop(t1 + .1); }
  });
  // piano-like tone
  const pianoBus = bus(.8, .5);
  const piano = (t, m, v = .3, pan = 0, dec = 2.6) => {
    const f = mtof(m), g = ctx.createGain(), p = ctx.createStereoPanner(); p.pan.value = pan;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .004); g.gain.exponentialRampToValueAtTime(v * .35, t + .25); g.gain.exponentialRampToValueAtTime(.0008, t + dec);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(9000, f * 9), t); lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 2), t + dec);
    [[1, 1], [2.003, .45], [3.01, .22], [4.02, .1], [5.04, .05]].forEach(([h, a]) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * h; const og = ctx.createGain(); og.gain.value = a; o.connect(og); og.connect(lp); o.start(t); o.stop(t + dec + .1); });
    lp.connect(g); g.connect(p); p.connect(pianoBus);
  };
  // title
  piano(0.02, 74, .28, .1, 3.5); piano(0.02, 69, .2, -.15, 3.5); piano(0.02, 50, .2, 0, 3.5);
  piano(2.667, 62, .26, -.1, 3); piano(2.667, 65, .2, .15, 3); piano(2.667, 38, .3, 0, 3);
  // descending arpeggio while travelling down the spine (bars 3-4)
  [[70, 65, 62, 58, 65, 62, 58, 53], [69, 65, 60, 57, 65, 60, 57, 53]].forEach((seq, b) => seq.forEach((m, i) => piano(2 * BARL + b * BARL + i * B / 2, m, .13 + (i === 0 ? .06 : 0), (i % 2 ? .3 : -.3), 1.6)));
  piano(8.0, 69, .26, -.1, 3); piano(8.0, 74, .22, .1, 3); piano(8.0, 41, .25, 0, 3);
  // axial reveal: bell chord + label pings
  [74, 70, 67].forEach((m, i) => piano(10.667 + i * .04, m + 12, .1, (i - 1) * .4, 3.5));
  piano(10.667, 43, .26, 0, 3);
  [[10.95, 79], [11.35, 82], [11.75, 86]].forEach(([t, m]) => piano(t, m, .07, .35, 1.2));
  // tension
  piano(13.333, 55, .2, 0, 2.5); piano(13.333, 31, .28, 0, 2.5);
  piano(16.0, 38, .34, 0, 3.2); piano(16.0, 45, .26, -.2, 3.2); piano(16.0, 46, .22, .2, 3.2);
  piano(18.667, 57, .22, -.2, 3); piano(18.667, 70, .17, .25, 3); piano(18.667, 73, .2, .05, 3); piano(18.667, 33, .3, 0, 3);
  // resolution
  [62, 69, 74, 77].forEach((m, i) => piano(21.333 + i * .07, m, .2, (i - 1.5) * .25, 4));
  piano(21.333, 38, .3, 0, 4);
  piano(24.0, 81, .12, .2, 2.6); piano(24.0, 74, .1, -.2, 2.6);

  // heartbeat (lub-dub)
  const kickBus = bus(1, .08);
  const kick = (t, v = .5, f0 = 110, f1 = 42, dec = .32) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + .12); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .005); g.gain.exponentialRampToValueAtTime(.001, t + dec); o.connect(g); g.connect(kickBus); o.start(t); o.stop(t + dec + .05); };
  for (let bt = 3; bt < 36; bt++) { const t = bt * B; if (t > 24.2) break; const bar = Math.floor(bt / 4);
    let every = bar >= 5 && bar <= 7 ? 1 : 2; if (bt % every) continue; if (bar === 2 || bar === 3) { if (bt % 2) continue; }
    const v = bar >= 5 && bar <= 7 ? .5 : bar >= 8 ? .26 : .32; kick(t, v); kick(t + .2, v * .6, 90, 40, .25); }
  kick(2.667, .7, 140, 38, .5); kick(8.0, .45, 120, 40, .4); kick(16.0, .85, 150, 34, .7); kick(18.667, .6, 130, 36, .5);
  // soft hats on travel (bars 3-4)
  const hatBus = bus(.5, .15, .2);
  for (let i = 0; i < 16; i++) { const t = 2 * BARL + i * B / 2 + B / 4; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7000; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.045, t + .003); g.gain.exponentialRampToValueAtTime(.001, t + .06); hp.connect(g); g.connect(hatBus); noise(t, .08, hp); }

  // ---------- SFX ----------
  const sfx = bus(.9, .35);
  const whoosh = (t0, dur, f0, f1, v = .25, pan = 0) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4; bp.frequency.setValueAtTime(f0, t0); bp.frequency.exponentialRampToValueAtTime(f1, t0 + dur); const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + dur * .55); g.gain.linearRampToValueAtTime(0, t0 + dur); const p = ctx.createStereoPanner(); p.pan.setValueAtTime(-pan, t0); p.pan.linearRampToValueAtTime(pan, t0 + dur); bp.connect(g); g.connect(p); p.connect(sfx); noise(t0, dur, bp); };
  const click = (t, f = 2000, v = .12, dec = .03, pan = 0) => { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = 3; const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .002); g.gain.exponentialRampToValueAtTime(.001, t + dec); const p = ctx.createStereoPanner(); p.pan.value = pan; bp.connect(g); g.connect(p); p.connect(sfx); noise(t, dec + .02, bp); };
  const blop = (t, f0, f1, v = .2, dur = .25) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * .6); const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + .05); };
  // plates in + letters
  whoosh(0.0, .9, 400, 2400, .2, .6); whoosh(0.08, .9, 300, 1800, .18, -.6);
  kick(0.92, .35, 160, 60, .2);
  for (let i = 0; i < 5; i++) { const t = .32 + .085 * i + .42; click(t, 1800 + i * 300, .1, .04, (i - 2) * .25); }
  // squeeze creak
  { const t0 = 2.25, bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6; bp.frequency.setValueAtTime(300, t0); bp.frequency.exponentialRampToValueAtTime(900, 2.66); const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.18, 2.64); g.gain.linearRampToValueAtTime(0, 2.68); bp.connect(g); g.connect(sfx); noise(t0, .45, bp); }
  blop(2.667, 260, 720, .26, .35); blop(2.75, 520, 300, .08, .2);
  // recede + travel
  whoosh(3.7, 1.6, 2500, 400, .14, -.4);
  whoosh(5.33, 2.7, 1800, 300, .2, .5);
  // arrival / lift / tilt
  // title tension bed 0.6-2.667: low D drone swell + rising airy noise (fills the pre-squeeze gap)
  { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(38); const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(120, .6); lp.frequency.exponentialRampToValueAtTime(700, 2.62);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, .6); g.gain.linearRampToValueAtTime(.09, 2.6); g.gain.linearRampToValueAtTime(0, 2.7); o.connect(lp); lp.connect(g); g.connect(sfx); o.start(.6); o.stop(2.75);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2; bp.frequency.setValueAtTime(600, 1.0); bp.frequency.exponentialRampToValueAtTime(4000, 2.64);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, 1.0); ng.gain.linearRampToValueAtTime(.07, 2.62); ng.gain.linearRampToValueAtTime(0, 2.672); bp.connect(ng); ng.connect(sfx); noise(1.0, 1.7, bp);
    [[1.333, 62], [1.667, 65], [2.0, 69], [2.333, 72]].forEach(([t, m], i) => piano(t, m, .07 + i * .015, (i % 2 ? .3 : -.3), 1.4)); }
  whoosh(7.6, .5, 600, 2000, .08);
  click(9.2, 900, .18, .08); click(9.24, 1400, .1, .05);
  whoosh(9.3, 1.4, 500, 3000, .17, -.5);
  // pressure groan 13.3-16
  { const t0 = 13.3, lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(120, t0); lp.frequency.linearRampToValueAtTime(420, 16.0); const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.3, 15.9); g.gain.linearRampToValueAtTime(0, 16.3); lp.connect(g); g.connect(sfx); noise(t0, 3.1, lp);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(48, t0); o.frequency.linearRampToValueAtTime(58, 16); const ol = ctx.createBiquadFilter(); ol.type = 'lowpass'; ol.frequency.value = 200; const og = ctx.createGain(); og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(.08, 15.9); og.gain.linearRampToValueAtTime(0, 16.2); o.connect(ol); ol.connect(og); og.connect(sfx); o.start(t0); o.stop(16.4); }
  // ghost press thuds on beats + crack steps
  [13.333, 14.0, 14.667, 15.333].forEach((t, i) => kick(t - .1, .18 + i * .04, 90, 45, .22));
  [14.0, 14.667, 15.333].forEach((t, i) => { for (let k = 0; k < 6 + i * 3; k++) click(t + rnd() * .16, 2500 + rnd() * 3500, .06 + .03 * i, .015 + rnd() * .02, rnd() - .5); });
  // final snap 16.0
  { const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500; const g = ctx.createGain(); g.gain.setValueAtTime(0, 16.0); g.gain.linearRampToValueAtTime(.35, 16.003); g.gain.exponentialRampToValueAtTime(.001, 16.25); hp.connect(g); g.connect(sfx); noise(16.0, .3, hp); }
  for (let k = 0; k < 14; k++) click(16.0 + rnd() * .3, 2000 + rnd() * 4000, .08, .02, rnd() - .5);
  // gel squish 16.1-18.6
  { const t0 = 16.1, t1 = 18.6, lp = ctx.createBiquadFilter(); lp.type = 'bandpass'; lp.Q.value = 4; lp.frequency.setValueAtTime(180, t0);
    for (let x = t0; x < t1; x += .18) lp.frequency.linearRampToValueAtTime(160 + rnd() * 260, x + .18);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(.32, t0 + .4); g.gain.linearRampToValueAtTime(.22, t1 - .2); g.gain.linearRampToValueAtTime(0, t1 + .05); lp.connect(g); g.connect(sfx); noise(t0, t1 - t0 + .1, lp);
    for (const [t, a, b] of [[16.3, 180, 320], [17.0, 200, 360], [17.7, 220, 420], [18.3, 240, 480]]) blop(t, a, b, .1, .3); }
  // nerve contact + pain zaps
  const zap = (t, v = .1, dur = .35) => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.setValueAtTime(2400, t); bp.frequency.exponentialRampToValueAtTime(700, t + dur); bp.Q.value = 2; const tr = ctx.createGain(); const lfo = ctx.createOscillator(); lfo.frequency.value = 38; const lg = ctx.createGain(); lg.gain.value = .5; lfo.connect(lg); lg.connect(tr.gain); tr.gain.value = .5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .01); g.gain.exponentialRampToValueAtTime(.001, t + dur); o.connect(bp); bp.connect(tr); tr.connect(g); g.connect(sfx); o.start(t); o.stop(t + dur + .05); lfo.start(t); lfo.stop(t + dur + .05);
    const s = ctx.createOscillator(); s.type = 'sine'; s.frequency.setValueAtTime(1320, t); s.frequency.exponentialRampToValueAtTime(440, t + dur * .8); const sg = ctx.createGain(); sg.gain.setValueAtTime(0, t); sg.gain.linearRampToValueAtTime(v * .35, t + .01); sg.gain.exponentialRampToValueAtTime(.001, t + dur * .8); s.connect(sg); sg.connect(sfx); s.start(t); s.stop(t + dur); };
  zap(18.667, .2, .6);
  for (let i = 1; i < 4; i++) zap(18.667 + i * B, .09 - i * .012, .3);
  // pull back + resolve swell
  whoosh(20.9, .6, 300, 3000, .12, .4); whoosh(21.333, 1.8, 3000, 400, .1, -.4);
  // final shimmer
  for (let i = 0; i < 6; i++) piano(21.6 + i * .12, 86 + [0, 3, 5, 7, 10, 12][i], .03, (i / 5 - .5), 1.5);

  const buf = await ctx.startRendering();
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  // normalise peak to -1 dBFS
  let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
  const gain = pk > 0 ? Math.pow(10, -1 / 20) / pk : 1;
  const out = new Int16Array(L.length * 2);
  for (let i = 0; i < L.length; i++) { out[2 * i] = Math.max(-32767, Math.min(32767, L[i] * gain * 32767)); out[2 * i + 1] = Math.max(-32767, Math.min(32767, R[i] * gain * 32767)); }
  // base64
  const bytes = new Uint8Array(out.buffer); let s = ''; const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return { b64: btoa(s), sr: SR, peak: pk, gain, frames: L.length };
};
