// Captions = the speaker's own words, nothing else. Built only from plan.words.
const PAUSE_BREAK = 0.35; // seconds of silence that force a new caption chunk
const LINGER = 0.4;       // how long the last chunk stays after its last word

const assTime = (t) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};
// #RRGGBB -> &H00BBGGRR
const assColor = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const c = m ? m[1] : 'FFD400';
  return `&H00${c.slice(4, 6)}${c.slice(2, 4)}${c.slice(0, 2)}`.toUpperCase();
};
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/[{}]/g, '').replace(/\n/g, ' ');

export function chunkWords(plan) {
  const { maxWords, maxChars } = plan.captions;
  const chunks = [];
  let cur = [];
  const flush = () => { if (cur.length) chunks.push(cur); cur = []; };
  for (const w of plan.words) {
    const prev = cur[cur.length - 1];
    const len = cur.reduce((n, x) => n + x.w.length + 1, 0) + w.w.length;
    if (prev && (
      cur.length >= maxWords ||
      len > maxChars ||
      w.s - prev.e > PAUSE_BREAK ||
      w.take !== prev.take ||
      /[.!?…]$/.test(prev.w)
    )) flush();
    cur.push(w);
  }
  flush();
  return chunks;
}

export function buildAss(plan) {
  const { w: W, h: H } = plan.format;
  const c = plan.captions;
  const size = Math.round(W * 0.078);
  const marginV = Math.round(H * (1 - c.position));
  const hi = assColor(c.highlight);
  const inClimax = (w) => plan.beats.some((b) => w.s < b.climax[1] && w.e > b.climax[0]);

  const head = `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter ExtraBold,${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,${Math.round(size * 0.09)},${Math.round(size * 0.04)},2,${Math.round(W * 0.08)},${Math.round(W * 0.08)},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = [];
  const chunks = chunkWords(plan);
  chunks.forEach((ch, ci) => {
    const next = chunks[ci + 1];
    const chunkEnd = Math.min(next ? next[0].s : Infinity, ch[ch.length - 1].e + LINGER, plan.duration);
    // one event per active word so the spoken word is highlighted
    ch.forEach((w, wi) => {
      const s = wi === 0 ? ch[0].s : w.s;
      const e = wi === ch.length - 1 ? chunkEnd : ch[wi + 1].s;
      if (e - s < 0.01) return;
      const text = ch.map((x, xi) => {
        let t = esc(c.uppercase ? x.w.toUpperCase() : x.w);
        if (xi === wi) t = `{\\c${hi}${inClimax(x) ? '\\fscx112\\fscy112' : ''}}${t}{\\r}`;
        return t;
      }).join(' ');
      const pop = wi === 0 ? '{\\fad(40,0)\\t(0,90,\\fscx104\\fscy104)\\t(90,160,\\fscx100\\fscy100)}' : '';
      lines.push(`Dialogue: 0,${assTime(s)},${assTime(e)},Cap,,0,0,0,,${pop}${text}`);
    });
  });
  return head + lines.join('\n') + '\n';
}

// Words visible on screen, for the "nothing the speaker didn't say" QC check.
export function assWords(ass) {
  const seen = new Map();
  for (const line of ass.split('\n')) {
    if (!line.startsWith('Dialogue:')) continue;
    const text = line.split(',').slice(9).join(',').replace(/\{[^}]*\}/g, '');
    for (const w of text.split(/\s+/).filter(Boolean)) seen.set(w, (seen.get(w) || 0) + 1);
  }
  return [...seen.keys()];
}
