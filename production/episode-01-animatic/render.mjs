// Playwright арқылы кадрларды рендерлеу.
// node render.mjs                     → барлық 1440 кадр (frames/00000.jpg …)
// node render.mjs --times 2,8,15      → тек көрсетілген секундтар (preview/t_2.png …)
// node render.mjs --from 0 --to 720   → кадр ауқымы (параллель рендер үшін)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24, TOTAL = 60 * FPS;
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--font-render-hinting=none'],
});
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[page]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/scene.html`);
await page.waitForFunction(() => window.sceneReady === true, null, { timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
const stage = page.locator('#stage');

const times = opt('times');
if (times) {
  fs.mkdirSync(path.join(ROOT, 'preview'), { recursive: true });
  for (const s of times.split(',').map(Number)) {
    await page.evaluate((t) => window.renderAt(t), s);
    await stage.screenshot({ path: path.join(ROOT, 'preview', `t_${s}.png`) });
    console.log('preview', s);
  }
} else {
  const from = Number(opt('from', 0)), to = Number(opt('to', TOTAL));
  const dir = path.join(ROOT, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    const out = path.join(dir, String(f).padStart(5, '0') + '.jpg');
    if (fs.existsSync(out)) continue;
    await page.evaluate((t) => window.renderAt(t), f / FPS);
    await stage.screenshot({ path: out, type: 'jpeg', quality: 92 });
    if (f % 24 === 0) console.log(`frame ${f}/${to}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
await browser.close();
server.close();
