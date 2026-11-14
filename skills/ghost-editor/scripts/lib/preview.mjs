import { sfxEvents } from './render.mjs';

// $P/preview.html — opens the render with a timeline of takes / beats / memes / sfx.
// All paths are relative to $P, which is why build.mjs copies assets into the project.
export function previewHtml(plan, qcRes) {
  const D = plan.duration || 1;
  const pct = (t) => ((100 * t) / D).toFixed(3);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const takes = plan.takes.map((t) => `<div class="blk take" style="left:${pct(t.at)}%;width:${pct(t.dur)}%" title="take ${t.i}: src ${t.in}–${t.out}s ${esc(t.note)}" data-t="${t.at}">${t.i}</div>`).join('');
  const beats = plan.beats.map((b) => `<div class="blk climax" style="left:${pct(b.climax[0])}%;width:${pct(b.climax[1] - b.climax[0])}%" title="climax ${b.climax[0]}–${b.climax[1]}s${b.zoom ? ' zoom ' + b.zoom : ''} ${esc(b.note)}" data-t="${b.climax[0]}"></div>`).join('');
  const memes = plan.beats.filter((b) => b.meme).map((b) => `<div class="blk meme" style="left:${pct(b.meme.start)}%;width:${pct(b.meme.end - b.meme.start)}%" title="${esc(b.meme.file)} (${b.meme.mode})" data-t="${b.meme.start}"></div>`).join('');
  const sfx = sfxEvents(plan).map((e) => `<div class="tick" style="left:${pct(e.at)}%" title="${esc(e.name)} ${e.gain}dB — ${esc(e.why)}" data-t="${e.at}"></div>`).join('');
  const words = plan.words.map((w) => `<span data-t="${w.s}" data-e="${w.e}">${esc(w.w)}</span>`).join(' ');
  const qcRows = (qcRes || []).map((r) => `<li class="${r.level}"><b>${r.level}</b> ${esc(r.name)} <span>${esc(r.detail || '')}</span></li>`).join('');

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ghost Editor Preview</title>
<style>
:root{--bg:#111;--fg:#eee;--mut:#888;--line:#2a2a2a;--take:#3b6fd8;--clx:#e0a100;--meme:#d8436b;--ok:#3fb950;--warn:#d29922;--bad:#f85149}
@media (prefers-color-scheme: light){:root{--bg:#fafafa;--fg:#111;--mut:#666;--line:#ddd}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:16px;display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:20px}
@media (max-width:760px){main{grid-template-columns:1fr}}
video{width:100%;background:#000;border-radius:8px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:18px 0 6px}
.lane{position:relative;height:22px;border-bottom:1px solid var(--line);cursor:pointer}
.lane label{position:absolute;left:-0px;top:-16px;font-size:11px;color:var(--mut)}
.blk{position:absolute;top:3px;bottom:3px;border-radius:3px;font-size:10px;color:#fff;padding-left:3px;overflow:hidden}
.take{background:var(--take);border-right:1px solid var(--bg)}.climax{background:var(--clx)}.meme{background:var(--meme)}
.tick{position:absolute;top:2px;bottom:2px;width:2px;background:var(--fg)}
#head{position:absolute;top:0;bottom:0;width:2px;background:var(--bad);pointer-events:none}
.tl{position:relative;display:grid;gap:18px;padding-top:16px}
#words span{cursor:pointer;border-radius:3px;padding:0 1px}#words span.on{background:var(--clx);color:#000}
ul{list-style:none;padding:0;margin:0}li{padding:2px 0}li span{color:var(--mut)}
li.PASS b{color:var(--ok)}li.WARN b{color:var(--warn)}li.FAIL b{color:var(--bad)}
</style></head><body><main>
<div><video id="v" src="${esc(plan.output)}" controls playsinline></video><h2>QC</h2><ul>${qcRows || '<li>not run</li>'}</ul></div>
<div>
<h2>Timeline · ${D}s</h2>
<div class="tl" id="tl"><div class="lane"><label>takes</label>${takes}</div><div class="lane"><label>climax</label>${beats}</div><div class="lane"><label>memes</label>${memes}</div><div class="lane"><label>sfx</label>${sfx}</div><div id="head"></div></div>
<h2>Captions (spoken words)</h2><p id="words">${words}</p>
</div></main>
<script>
const v=document.getElementById('v'),head=document.getElementById('head'),tl=document.getElementById('tl'),D=${D};
const ws=[...document.querySelectorAll('#words span')];
document.addEventListener('click',e=>{const t=e.target.closest('[data-t]');if(t){v.currentTime=+t.dataset.t;v.play()}});
tl.addEventListener('click',e=>{if(e.target.closest('[data-t]'))return;const r=tl.getBoundingClientRect();v.currentTime=D*(e.clientX-r.left)/r.width});
v.addEventListener('timeupdate',()=>{head.style.left=(100*v.currentTime/D)+'%';const t=v.currentTime;ws.forEach(s=>s.classList.toggle('on',t>=+s.dataset.t&&t<+s.dataset.e))});
</script></body></html>
`;
}
