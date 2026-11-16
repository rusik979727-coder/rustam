'use strict';
// install/ папкасындағы 2 файл (пайдаланушы көшіретін нұсқа) түпнұсқамен сәйкес әрі жұмыс істейтінін тексереді.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { build, OUT } = require('../scripts/bundle');
const { loadApp } = require('./fake-gas');
const { sampleSpreadsheet } = require('./fixture');

test('install/ файлдары жаңартылған (npm run bundle іске қосылған)', () => {
  const fresh = build();
  for (const name of Object.keys(fresh)) {
    const onDisk = fs.readFileSync(path.join(OUT, name), 'utf8');
    assert.equal(onDisk, fresh[name], 'install/' + name + ' ескірген: npm run bundle іске қосыңыз');
  }
});

test('install/Index.html ішінде шаблон тегтері қалмаған', () => {
  const html = build()['Index.html'];
  assert.doesNotMatch(html, /<\?/);
  assert.match(html, /<style>/);
  assert.match(html, /google\.script\.run/);
});

test('біріктірілген install/Code.gs жеке файлдардағыдай жұмыс істейді', () => {
  const app = loadApp(sampleSpreadsheet(), { sources: [{ name: 'install/Code.gs', code: build()['Code.gs'] }] });
  const day = app.getDay('16.11.2026');
  assert.equal(day.doctor.length, 29);
  const slot = day.doctor.find((s) => s.time === '09:20');
  const saved = app.saveAppointment('16.11.2026', slot.row, { name: 'Тест', recorder: 'Асель' }, slot.prev);
  assert.equal(saved.doctor.find((s) => s.row === slot.row).name, 'Тест');
  assert.deepEqual(app.createDay('2026-11-17'), { sheet: '17.11.2026', created: true });
  assert.equal(typeof app.doGet, 'function');
});
