// Usage:
//   node render.mjs stills 2.7 8.3 ...   -> out/still_<t>.png
//   node render.mjs frames [from] [to]   -> frames/f_00000.png ... (4 workers)
//   node render.mjs audio                -> out/audio.wav
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL0 = `http://127.0.0.1:${server.address().port}/scene.html`;
const [, , mode, ...args] = process.argv;
fs.mkdirSync(path.join(ROOT, 'out'), { recursive: true });

const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb'] });
async function newPage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('PAGEERR', e.message));
  await page.goto(URL0 + '?none');
  await page.evaluate(() => window.ready);
  return page;
}
const grab = (page, fi) => page.evaluate(fi => { window.renderFrame(fi); return document.getElementById('c').toDataURL('image/png'); }, fi);

if (mode === 'stills') {
  const page = await newPage();
  for (const a of args) {
    const fi = Math.round(parseFloat(a) * 60);
    const d = await grab(page, fi);
    fs.writeFileSync(path.join(ROOT, 'out', `still_${a}.png`), Buffer.from(d.split(',')[1], 'base64'));
    console.log('still', a);
  }
} else if (mode === 'frames') {
  const total = await (await newPage()).evaluate(() => window.NFRAMES);
  const from = args[0] ? +args[0] : 0, to = args[1] ? +args[1] : total;
  const dir = path.join(ROOT, 'frames'); fs.mkdirSync(dir, { recursive: true });
  const NW = 4; let next = from, done = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: NW }, async () => {
    const page = await newPage();
    while (true) {
      const fi = next++; if (fi >= to) break;
      const d = await grab(page, fi);
      fs.writeFileSync(path.join(dir, `f_${String(fi).padStart(5, '0')}.png`), Buffer.from(d.split(',')[1], 'base64'));
      if (++done % 100 === 0) console.log(`${done}/${to - from}  ${((Date.now() - t0) / done).toFixed(0)} ms/frame`);
    }
  }));
  console.log('frames done', done, ((Date.now() - t0) / 1000).toFixed(1) + 's');
} else if (mode === 'audio') {
  const page = await newPage();
  const r = await page.evaluate(() => window.buildAudio());
  const pcm = Buffer.from(r.b64, 'base64');
  const hdr = Buffer.alloc(44);
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12);
  hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22); hdr.writeUInt32LE(r.sr, 24);
  hdr.writeUInt32LE(r.sr * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(path.join(ROOT, 'out', 'audio.wav'), Buffer.concat([hdr, pcm]));
  console.log('audio', r.frames, 'samples, raw peak', r.peak.toFixed(3), 'gain', r.gain.toFixed(3));
}
await browser.close(); server.close();
