// Code.gs-ті жалған SpreadsheetApp/CacheService-пен Node-та тексеру: node tests/code.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

let apiCalls = 0;

function makeSheet(name, grid, merges, validations) {
  const sh = {
    name, grid, merges, validations,
    getName() { return this.name; },
    getMaxRows() { return 1000; },
    getLastRow() {
      for (let r = this.grid.length; r > 0; r--) if (this.grid[r - 1].some(v => v !== '')) return r;
      return 0;
    },
    getRange(r, c, nr = 1, nc = 1) { return makeRange(this, r, c, nr, nc); },
    getRangeList(a1s) {
      apiCalls++;
      return { clearContent: () => a1s.forEach(a => parseA1(this, a).clearContentNoCount()) };
    }
  };
  return sh;
}

function parseA1(sh, a1) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1);
  const col = s => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const c1 = col(m[1]), r1 = +m[2], c2 = col(m[3]), r2 = +m[4];
  return makeRange(sh, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
}

function makeRange(sh, r, c, nr, nc) {
  const ensure = () => { while (sh.grid.length < r + nr - 1) sh.grid.push(Array(26).fill('')); };
  const read = () => { ensure(); const out = []; for (let i = 0; i < nr; i++) out.push(sh.grid[r - 1 + i].slice(c - 1, c - 1 + nc).map(v => v === '' ? '' : String(v))); return out; };
  const clear = () => { ensure(); for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.grid[r - 1 + i][c - 1 + j] = ''; };
  return {
    getDisplayValues() { apiCalls++; return read(); },
    getValues() { apiCalls++; return read(); },
    setValues(v) { apiCalls++; ensure(); v.forEach((row, i) => row.forEach((x, j) => { sh.grid[r - 1 + i][c - 1 + j] = typeof x === 'string' ? x.replace(/^'/, '') : x; })); },
    setValue(x) { apiCalls++; ensure(); sh.grid[r - 1][c - 1] = x; },
    clearContent() { apiCalls++; clear(); },
    clearContentNoCount: clear,
    getMergedRanges() {
      apiCalls++;
      return sh.merges.filter(m => m.start >= r && m.start < r + nr)
        .map(m => ({ getRow: () => m.start, getLastRow: () => m.end }));
    },
    getDataValidations() {
      apiCalls++;
      return [Array.from({ length: nc }, (_, j) => {
        const list = sh.validations[c + j];
        return list ? { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [list] } : null;
      })];
    }
  };
}

function daySheet(name) {
  const grid = [];
  for (let i = 0; i < 40; i++) grid.push(Array(26).fill(''));
  grid[1][1] = 'ФИ пациента';
  const doctorTimes = ['9:00', '9:20', '9:40', '10:00', '10:20'];
  doctorTimes.forEach((t, i) => { grid[2 + i][0] = t; });
  const merges = [];
  ['8:30', '9:30', '10:30'].forEach((t, i) => {
    const row = 3 + i * 3;
    grid[row - 1][9] = t;
    merges.push({ start: row, end: row + 2 });
  });
  const validations = { 5: ['Гулназ', 'Асель'], 6: ['Таргет', '2ГИС'], 7: ['первичный', 'курс'], 8: ['✅', '❌'] };
  return makeSheet(name, grid, merges, validations);
}

const sheets = [daySheet('16.11.2026'), daySheet('17.11.2026'), makeSheet('Лист5', [], [], {})];
const store = new Map();

const ctx = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({
      getSheets: () => sheets,
      getSheetByName: n => sheets.find(s => s.name === n) || null,
      getName: () => 'Test', getUrl: () => 'u', getSpreadsheetTimeZone: () => 'Asia/Almaty',
      insertSheet(name, pos, opts) {
        const t = opts.template;
        const sh = makeSheet(name, t.grid.map(r => r.slice()), t.merges.slice(), t.validations);
        sheets.splice(pos, 0, sh);
        return sh;
      }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      getAll(keys) { apiCalls++; const o = {}; keys.forEach(k => { if (store.has(k)) o[k] = store.get(k); }); return o; },
      putAll(map) { apiCalls++; Object.keys(map).forEach(k => store.set(k, map[k])); },
      put(k, v) { apiCalls++; store.set(k, v); },
      remove(k) { apiCalls++; store.delete(k); },
      removeAll(ks) { apiCalls++; ks.forEach(k => store.delete(k)); }
    })
  },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-11-17' },
  Session: { getScriptTimeZone: () => 'Asia/Almaty' },
  HtmlService: {}
};
vm.createContext(ctx);
for (const f of ['Dates.gs', 'Sheet.gs', 'Code.gs']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', f), 'utf8'), ctx, { filename: f });
}
const run = (code) => vm.runInContext(code, ctx);

// 1. Bootstrap бүгінгі күнді бірге қайтарады
const boot = run('getBootstrap()');
assert.strictEqual(boot.today, '2026-11-17');
assert.strictEqual(boot.days.length, 2);
assert.ok(boot.todayDay && boot.todayDay.doctor.length === 5);
assert.deepStrictEqual(boot.todayDay.options.recorder, ['Гулназ', 'Асель']);

// 2. Екінші getDay кэштен — таблицаға бір де сұраныс жоқ (тек кэш)
apiCalls = 0;
const d1 = run('getDay("17.11.2026")');
assert.strictEqual(apiCalls, 1, 'getDay кэштен келуі керек');

// 3. Жазу
ctx.slot = d1.doctor[0];
const after = run('saveAppointment("17.11.2026", slot.row, {name:"Айгерім", phone:"87011234567", recorder:"Асель", service:"курс"}, slot.prev)');
assert.strictEqual(after.doctor[0].name, 'Айгерім');
assert.strictEqual(after.doctor[0].phone, '+7 701 123 45 67');
assert.strictEqual(sheets[1].grid[2][1], 'Айгерім');
// Кэш жаңарды
assert.strictEqual(run('getDay("17.11.2026")').doctor[0].name, 'Айгерім');

// 4. Ескі prev-пен жазу → CONFLICT, кэш өшеді
assert.throws(() => run('saveAppointment("17.11.2026", slot.row, {name:"X", recorder:"Асель"}, slot.prev)'), /CONFLICT/);
assert.ok(!store.has('day:v2:17.11.2026'));

// 5. Келді белгісі
let day = run('getDay("17.11.2026")');
ctx.slot = day.doctor[0];
day = run('setAttendance("17.11.2026", slot.row, "✅", slot.prev)');
assert.strictEqual(day.doctor[0].attended, '✅');
assert.throws(() => run('setAttendance("17.11.2026", slot.row, "??", null)'), /таблицада жоқ/);

// 6. Басқа күнге көшіру
ctx.slot = run('getDay("17.11.2026")').doctor[0];
day = run('moveAppointment("17.11.2026", slot.row, "16.11.2026", 5, slot.prev)');
assert.strictEqual(day.doctor[0].booked, false);
const d16 = run('getDay("16.11.2026")');
assert.strictEqual(d16.doctor.find(s => s.row === 5).name, 'Айгерім');

// 7. Физио + соңғы ем
const pl = run('getDay("16.11.2026")').physio[0].places[0];
ctx.pl = pl;
day = run('savePhysio("16.11.2026", pl.row, {name:"Болат", proc:"Физио", total:"10", day:"3"}, pl.prev)');
assert.strictEqual(day.physio[0].places[0].name, 'Болат');
const last = run('lastTreatment("болат", "2026-11-17")');
assert.strictEqual(last.day, '3');
assert.strictEqual(last.total, '10');

// 8. Іздеу және есеп: кэш толы болғанда таблицаға сұраныс жоқ
apiCalls = 0;
const found = run('searchPatient("7011234")');
assert.strictEqual(found.length, 1);
const st = run('getStats("2026-11-01", "2026-11-30")');
assert.strictEqual(st.total, 1);
assert.strictEqual(st.physio, 1);
assert.ok(apiCalls <= 2, 'іздеу/есеп кэштен алынуы керек, сұраныс саны: ' + apiCalls);

// 9. Қолмен өзгерту → onEdit кэшті өшіреді → жаңа мән көрінеді
sheets[1].grid[3][1] = 'Қолмен жазылған';
run('onEdit({ range: { getSheet: function () { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("17.11.2026"); } } })');
assert.strictEqual(run('getDay("17.11.2026")').doctor[1].name, 'Қолмен жазылған');

// 10. Жаңа күн: пациенттер тазаланады, уақыттар қалады
const res = run('createDay("2026-11-18")');
assert.strictEqual(res.sheet, '18.11.2026'); assert.strictEqual(res.created, true);
const d18 = run('getDay("18.11.2026")');
assert.strictEqual(d18.doctor.length, 5);
assert.ok(d18.doctor.every(s => !s.booked));
assert.ok(d18.physio.every(b => b.taken === 0));
assert.strictEqual(sheets.findIndex(s => s.name === '18.11.2026'), 2);

console.log('Барлық тексеру өтті ✔');

// 11. Біреу таблицаға жол қосты (onEdit іске қосылмайды) → жазу тоқтатылады, кэш тазаланады
const before17 = run('getDay("17.11.2026")');
const s17 = sheets.find(s => s.name === '17.11.2026');
s17.grid.splice(2, 0, Array(26).fill(''));       // 3-жолға бос жол қосылды
s17.grid[2][0] = '8:40';
s17.merges = s17.merges.map(m => ({ start: m.start + 1, end: m.end + 1 }));
ctx.slot = before17.doctor[2];
assert.throws(() => run('saveAppointment("17.11.2026", slot.row, {name:"Y", recorder:"Асель"}, slot.prev)'), /CONFLICT/);
assert.ok(!s17.grid.some(r => r[1] === 'Y'), 'қате жолға жазылмауы керек');
const after17 = run('getDay("17.11.2026")');
assert.strictEqual(after17.doctor[0].time, '08:40');
console.log('Жол қосу тексерісі өтті ✔');
