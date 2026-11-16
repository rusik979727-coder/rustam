// Жергілікті алдын ала қарау: Apps Script-ке жүктемей-ақ интерфейсті тексеру үшін.
// Code.gs жалған таблицамен (tests/fixture.js) Node-та жұмыс істейді,
// ал браузердегі google.script.run шақырулары /rpc арқылы осында келеді.
//   node dev/server.js  →  http://localhost:8080
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('../tests/fake-gas');
const { sampleSpreadsheet } = require('../tests/fixture');

const DIR = path.join(__dirname, '..', 'apps-script');
const PORT = Number(process.env.PORT) || 8080;
const app = loadApp(sampleSpreadsheet());

const MOCK = `<script>
window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const runner = new Proxy({}, { get(_, fn) {
    if (fn === 'withSuccessHandler') return (f) => { ok = f; return runner; };
    if (fn === 'withFailureHandler') return (f) => { fail = f; return runner; };
    return (...args) => fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn, args }) })
      .then((r) => r.json()).then((r) => r.error ? fail(new Error(r.error)) : ok(r.result));
  }});
  return runner;
}}};
</script>`;

function page() {
  let html = fs.readFileSync(path.join(DIR, 'Index.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('(\w+)'\)\s*\?>/g, (_, name) =>
    fs.readFileSync(path.join(DIR, name + '.html'), 'utf8'));
  return html.replace('<head>', '<head>' + MOCK);
}

const PUBLIC = ['getBootstrap', 'getDay', 'saveAppointment', 'clearAppointment', 'setAttendance',
  'moveAppointment', 'savePhysio', 'createDay', 'searchPatient', 'getStats'];

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rpc') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const { fn, args } = JSON.parse(body);
      let out;
      try {
        if (!PUBLIC.includes(fn)) throw new Error('Белгісіз функция: ' + fn);
        out = { result: app[fn](...args) };
      } catch (e) {
        out = { error: e.message };
      }
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      }, 120);
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(PORT, () => console.log('Алдын ала қарау: http://localhost:' + PORT));
