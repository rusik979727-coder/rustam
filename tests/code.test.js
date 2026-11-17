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
    getLastColumn() {
      let m = 0;
      this.grid.forEach(r => r.forEach((v, i) => { if (v !== '') m = Math.max(m, i + 1); }));
      return m;
    },
    getLastRow() {
      for (let r = this.grid.length; r > 0; r--) if (this.grid[r - 1].some(v => v !== '')) return r;
      return 0;
    },
    getRange(r, c, nr = 1, nc = 1) { return makeRange(this, r, c, nr, nc); },
    getDataRange() { return makeRange(this, 1, 1, Math.max(this.getLastRow(), 1), 26); },
    setFrozenRows() { apiCalls++; },
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
    setFontWeight() { apiCalls++; },
    setDataValidation(rule) { apiCalls++; for (let j = 0; j < nc; j++) sh.validations[c + j] = rule; },
    getMergedRanges() {
      apiCalls++;
      return sh.merges.filter(m => m.start >= r && m.start < r + nr)
        .map(m => ({ getRow: () => m.start, getLastRow: () => m.end }));
    },
    getDataValidations() {
      apiCalls++;
      return [Array.from({ length: nc }, (_, j) => {
        const list = sh.validations[c + j];
        if (list && list.rangeRule) return { getCriteriaType: () => 'VALUE_IN_RANGE', getCriteriaValues: () => [list.src] };
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
  Logger: { log() {} },
  SpreadsheetApp: {
    newDataValidation: () => {
      const r = { rangeRule: true };
      const b = { requireValueInRange(src) { r.src = src; return b; }, setAllowInvalid() { return b; }, build: () => r };
      return b;
    },
    getActiveSpreadsheet: () => ({
      getSheets: () => sheets,
      getSheetByName: n => sheets.find(s => s.name === n) || null,
      getName: () => 'Test', getUrl: () => 'u', getSpreadsheetTimeZone: () => 'Asia/Almaty',
      insertSheet(name, pos, opts) {
        if (!opts) { const sh = makeSheet(name, [], [], {}); sheets.splice(pos, 0, sh); return sh; }
        const t = opts.template;
        const sh = makeSheet(name, t.grid.map(r => r.slice()), t.merges.slice(), Object.assign({}, t.validations));
        sheets.splice(pos, 0, sh);
        return sh;
      }
    })
  },
  CacheService: {
    getScriptCache: () => ({
      get(k) { apiCalls++; return store.has(k) ? store.get(k) : null; },
      getAll(keys) { apiCalls++; const o = {}; keys.forEach(k => { if (store.has(k)) o[k] = store.get(k); }); return o; },
      putAll(map) { apiCalls++; Object.keys(map).forEach(k => store.set(k, map[k])); },
      put(k, v) { apiCalls++; store.set(k, v); },
      remove(k) { apiCalls++; store.delete(k); },
      removeAll(ks) { apiCalls++; ks.forEach(k => store.delete(k)); }
    })
  },
  ScriptApp: (() => {
    const triggers = [];
    return {
      triggers,
      getProjectTriggers: () => triggers,
      newTrigger: (fn) => ({ forSpreadsheet: () => ({ onChange: () => ({ create: () => triggers.push({ getHandlerFunction: () => fn }) }) }) })
    };
  })(),
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: () => '2026-11-17' },
  Session: { getScriptTimeZone: () => 'Asia/Almaty' },
  HtmlService: {}
};
vm.createContext(ctx);
for (const f of ['Dates.gs', 'Sheet.gs', 'Code.gs', 'Patients.gs']) {
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

// 12. setup триггерді бір рет орнатады; құрылым өзгерісі кэшті тазалайды
assert.match(run('setup()'), /^Триггер орнатылды\. «Баптаулар» парағы жасалды\. 3 парақтағы/);
assert.match(run('setup()'), /^Триггер бұрыннан орнатылған\. «Баптаулар» парағы бұрыннан бар/);
assert.strictEqual(ctx.ScriptApp.triggers.length, 1);
run('getDay("17.11.2026")');
assert.ok(store.has('day:v2:17.11.2026'));
run('onTableChange({ changeType: "EDIT" })');
assert.ok(store.has('day:v2:17.11.2026'), 'EDIT кезінде бүкіл кэш тазаланбайды');
run('onTableChange({ changeType: "INSERT_ROW" })');
assert.ok(!store.has('day:v2:17.11.2026'), 'жол қосылғанда кэш тазалануы керек');
console.log('Триггер тексерісі өтті ✔');

// 13. «Баптаулар»: бар тізімдерден жасалды, dropdown-тар оған сілтенді
const bs = sheets.find(s => s.name === 'Баптаулар');
assert.deepStrictEqual(bs.grid[0].slice(0, 4), ['Менеджер', 'Қайдан келді', 'Қызмет', 'Ем түрлері']);
assert.deepStrictEqual(bs.grid.slice(1, 3).map(r => r[0]), ['Гулназ', 'Асель']);
assert.strictEqual(bs.grid[1][3], 'Физио');
const d17 = sheets.find(s => s.name === '17.11.2026');
assert.ok(d17.validations[5].rangeRule, 'записал бағаны Баптаулар-ға сілтенуі керек');
assert.ok(!d17.validations[8].rangeRule, 'келді ме бағаны өзгермеуі керек');

// 14. Баптаулар-ға жаңа менеджер жазылды → onEdit → қолданбада бірден шығады және сақтауға болады
bs.grid.push(Array(26).fill('')); bs.grid[3][0] = 'Дана';
bs.grid[3][3] = 'Массаж';
run('onEdit({ range: { getSheet: function () { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Баптаулар"); } } })');
const fresh17 = run('getDay("17.11.2026")');
assert.deepStrictEqual(Array.from(fresh17.options.recorder), ['Гулназ', 'Асель', 'Дана']);
assert.ok(fresh17.procedures.includes('Массаж'));
ctx.slot = fresh17.doctor.find(x => !x.booked);
const saved = run('saveAppointment("17.11.2026", slot.row, {name:"Жаңа", recorder:"Дана"}, slot.prev)');
assert.strictEqual(saved.doctor.find(x => x.row === ctx.slot.row).recorder, 'Дана');
// Жаңа күн парағы dropdown сілтемесін мұраға алады
run('createDay("2026-11-20")');
assert.ok(sheets.find(s => s.name === '20.11.2026').validations[5].rangeRule);
console.log('Баптаулар тексерісі өтті ✔');

// 15. Ем курстары: 16.11-де Болат 3/10 (08:30) — 18.11-ге 4/10 болып ұсынылады
const courses = run('getActiveCourses("18.11.2026")');
const bolat = courses.find(c => c.name === 'Болат');
assert.ok(bolat, 'Болат курста болуы керек');
assert.strictEqual(bolat.day, 4); assert.strictEqual(bolat.total, 10);
assert.strictEqual(bolat.time, '08:30'); assert.strictEqual(bolat.placed, false);
assert.strictEqual(bolat.missed, 1, '17.11 — жұмыс күні, Болат келмеді');
// Аяқталған курс тізімге кірмейді
let pl16 = run('getDay("16.11.2026")').physio[0].places[1];
ctx.pl = pl16;
run('savePhysio("16.11.2026", pl.row, {name:"Сәуле", proc:"Плазма", total:"5", day:"5"}, pl.prev)');
assert.ok(!run('getActiveCourses("18.11.2026")').some(c => c.name === 'Сәуле'));
// 08:30 блогын толтырып қоямыз → Болат ең жақын бос уақытқа (09:30) қойылуы керек
let d18b = run('getDay("18.11.2026")');
for (const [i, nm] of ['А', 'Б', 'В'].entries()) {
  ctx.pl = d18b.physio[0].places[i];
  d18b = run('savePhysio("18.11.2026", pl.row, {name:"' + nm + '", proc:"Физио"}, pl.prev)');
}
ctx.items = [bolat];
let res2 = run('placeCourses("18.11.2026", items)');
assert.deepStrictEqual(Array.from(res2.placed.map(p => p.time)), ['09:30']);
const placedPlace = res2.day.physio[1].places[0];
assert.strictEqual(placedPlace.name, 'Болат'); assert.strictEqual(placedPlace.day, '4'); assert.strictEqual(placedPlace.total, '10');
// Қайта басса — екінші рет қойылмайды
res2 = run('placeCourses("18.11.2026", items)');
assert.strictEqual(res2.placed.length, 0); assert.strictEqual(res2.skipped[0].reason, 'бұрыннан қойылған');
assert.ok(run('getActiveCourses("18.11.2026")').find(c => c.name === 'Болат').placed);
console.log('Ем курстары тексерісі өтті ✔');

// 16. Демалыс: бос парақ (ешкім жазылмаған күн) «келмеді» деп саналмайды
const s17x = sheets.find(s => s.name === '17.11.2026');
s17x.grid.forEach(r => { for (let c = 1; c <= 13; c++) if (c !== 9) r[c] = r[c] === 'ФИ пациента' ? r[c] : ''; });
run('clearCache()');
// 16.11 келді → 17.11 бос (демалыс) → 18.11 үшін «келмеді» болмауы керек
const bolat2 = run('getActiveCourses("18.11.2026")').find(c => c.name === 'Болат');
assert.strictEqual(bolat2.lastDate, '2026-11-16');
assert.strictEqual(bolat2.missed, 0);
console.log('Демалыс тексерісі өтті ✔');

// 17. Пациент картасы: жоспар бойынша келесі ем, «Курстағылар», қайта жазуды болдырмау
run('setup()');
const bs2 = sheets.find(s => s.name === 'Баптаулар');
assert.ok(bs2.grid[0].includes('Медбике') && bs2.grid[0].includes('Дәрігер'), 'Баптаулар-ға жаңа бағандар қосылуы керек');
ctx.card = { name: 'Нұрлан Ага', phone: '87071112233', start: '2026-11-16', total: '4',
  plan: ['Физио', 'Плазма', 'Физио', 'Плазма'], nurse: 'Әсем', doctor: 'Ерлан', note: 'тізе' };
let pr = run('savePatient(card)');
const nid = pr.savedId;
const nur = pr.patients.find(p => p.id === nid);
assert.strictEqual(nur.phone, '+7 707 111 22 33');
assert.deepStrictEqual(Array.from(nur.plan), ['Физио', 'Плазма', 'Физио', 'Плазма']);
assert.strictEqual(nur.visits, 0); assert.strictEqual(nur.nextProc, 'Физио');
assert.ok(pr.nurses.includes('Әсем'));
// Сол атпен екінші карта — қате
assert.throws(() => run('savePatient(card)'), /картасы бар/);
// 16.11-де келді (Физио, 1/4)
let p16 = run('getDay("16.11.2026")').physio[2].places[0];
ctx.pl = p16;
run('savePhysio("16.11.2026", pl.row, {name:"нұрлан ага", proc:"Физио", total:"4", day:"1"}, pl.prev)');
const nx = run('patientNext("' + nid + '", "2026-11-18")');
assert.strictEqual(nx.day, 2); assert.strictEqual(nx.proc, 'Плазма'); assert.strictEqual(nx.nurse, 'Әсем');
// Курстағылар: картадан, ем — Плазма, уақыты — соңғы келген уақыты
run('createDay("2026-11-19")');
const cc = run('getActiveCourses("19.11.2026")').find(c => c.cardId === nid);
assert.ok(cc, 'карталы пациент курстағылар тізімінде болуы керек');
assert.strictEqual(cc.proc, 'Плазма'); assert.strictEqual(cc.day, 2); assert.strictEqual(cc.time, '10:30');
ctx.items = [cc];
const pres = run('placeCourses("19.11.2026", items)');
assert.strictEqual(pres.placed.length, 1);
const placedN = pres.day.physio.flatMap(b => b.places).find(p => p.name === 'Нұрлан Ага');
assert.strictEqual(placedN.proc, 'Плазма'); assert.strictEqual(placedN.day, '2');
assert.ok(run('getActiveCourses("19.11.2026")').find(c => c.cardId === nid).placed);
// Карта өзгерту: курс 4 → 6, жоспар толықтырылады
ctx.card2 = Object.assign({}, ctx.card, { id: nid, total: '6' });
pr = run('savePatient(card2)');
const nur2 = pr.patients.find(p => p.id === nid);
assert.strictEqual(nur2.total, 6); assert.strictEqual(nur2.plan.length, 6); assert.strictEqual(nur2.visits, 2);
assert.strictEqual(pr.patients.filter(p => p.name === 'Нұрлан Ага').length, 1, 'жаңа жол қосылмауы керек');
const card = run('getPatientCard("' + nid + '")');
assert.strictEqual(card.visits.map(v => v.date).join(','), '2026-11-16,2026-11-19');
console.log('Пациент картасы тексерісі өтті ✔');
