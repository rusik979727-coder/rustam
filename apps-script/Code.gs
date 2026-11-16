/** @OnlyCurrentDoc */

/**
 * БЕЛЕС ГРАФИК — веб-приложение (Google Apps Script).
 * Скрипт көшірме кестеге байланған (Расширения → Apps Script), сондықтан
 * тек сол кестемен жұмыс істейді.
 *
 * Парақ құрылымы (әр күн — бір парақ):
 *   Консультация: A уақыт, B ФИ, C номер, D коммент, E записал (менеджер),
 *                 F источник, G услуга, H пд
 *   Ем:           J уақыт, K пациент, L ем түрі
 */

var CFG = {
  FIRST_ROW: 3,
  LAST_ROW: 80,
  TZ: 'Asia/Almaty',
  TEMPLATE_NAME: '5.11.2026 (копия)',
  DEFAULT_MANAGERS: ['Гулназ', 'Асель'],
  DEFAULT_PROCEDURES: ['Физио', 'Плазма', 'Система', 'Блокада']
};

var CONSULT_FIELDS = ['name', 'phone', 'comment', 'manager', 'source', 'service', 'paid']; // B..H
var COL = { A: 0, B: 1, H: 7, J: 9, K: 10, L: 11 };

/* ---------- Web app ---------- */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Белес график')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ---------- Көмекші функциялар ---------- */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Парақ атауынан күнді шығарады: "5.11.2026", "10.112026", "18.11.26". Күн болмаса null. */
function parseDayName_(name) {
  var s = String(name).trim();
  if (/копия|copy/i.test(s)) return null;
  var m = s.match(/^(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})$/);
  if (!m) return null;
  var d = +m[1], mo = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return y + '-' + pad_(mo) + '-' + pad_(d);
}

function pad_(n) { return (n < 10 ? '0' : '') + n; }

/** "9:00" → 540, "19" → 1140. Уақыт болмаса null. */
function parseTime_(v) {
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  var h = +m[1], mi = m[2] ? +m[2] : 0;
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function fmtTime_(min) { return Math.floor(min / 60) + ':' + pad_(min % 60); }

function readGrid_(sheet) {
  return sheet.getRange(1, 1, CFG.LAST_ROW, 12).getDisplayValues();
}

function cell_(grid, row, col) {
  var r = grid[row - 1];
  return r ? String(r[col] == null ? '' : r[col]).trim() : '';
}

function daySheets_() {
  var list = [];
  ss_().getSheets().forEach(function (sh) {
    var iso = parseDayName_(sh.getName());
    if (iso) list.push({ name: sh.getName(), date: iso, sheet: sh });
  });
  list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return list;
}

function sheetByName_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh || !parseDayName_(name)) throw new Error('Парақ табылмады: ' + name);
  return sh;
}

function todayIso_() {
  return Utilities.formatDate(new Date(), CFG.TZ, 'yyyy-MM-dd');
}

/* ---------- Парақты талдау ---------- */

/** Консультация жолдары: A бағанында уақыт тұрған жолдар. */
function consultRows_(grid) {
  var rows = [];
  for (var r = CFG.FIRST_ROW; r <= CFG.LAST_ROW; r++) {
    var t = parseTime_(cell_(grid, r, COL.A));
    if (t === null) continue;
    var rec = { row: r, time: fmtTime_(t) };
    CONSULT_FIELDS.forEach(function (f, i) { rec[f] = cell_(grid, r, COL.B + i); });
    rows.push(rec);
  }
  return rows;
}

/**
 * Ем блогы: J бағанындағы әр уақыт бір топ бастайды, топқа келесі уақытқа
 * дейінгі жолдар кіреді. Аралық жолдардың уақыты есептеліп шығарылады.
 */
function treatmentGroups_(grid) {
  var labels = [];
  for (var r = CFG.FIRST_ROW; r <= CFG.LAST_ROW; r++) {
    var t = parseTime_(cell_(grid, r, COL.J));
    if (t !== null) labels.push({ row: r, min: t });
  }
  var groups = [];
  labels.forEach(function (lb, i) {
    var next = labels[i + 1];
    var endRow = next ? next.row - 1 : Math.min(lb.row + 2, CFG.LAST_ROW);
    var span = endRow - lb.row + 1;
    var step = next ? (next.min - lb.min) / (next.row - lb.row) : 10;
    var g = { row: lb.row, time: fmtTime_(lb.min), rows: [] };
    for (var k = 0; k < span; k++) {
      var row = lb.row + k;
      var min = Math.round((lb.min + step * k) / 5) * 5;
      g.rows.push({
        row: row,
        time: fmtTime_(min),
        name: cell_(grid, row, COL.K),
        proc: cell_(grid, row, COL.L)
      });
    }
    groups.push(g);
  });
  return groups;
}

function dayData_(sheet) {
  var grid = readGrid_(sheet);
  return {
    name: sheet.getName(),
    date: parseDayName_(sheet.getName()),
    consults: consultRows_(grid),
    treatments: treatmentGroups_(grid)
  };
}

function normalizeProc_(p) {
  var s = String(p).trim().toLowerCase();
  if (!s) return '';
  if (s.indexOf('физ') === 0) return 'Физио';
  if (s.indexOf('плаз') === 0) return 'Плазма';
  if (s.indexOf('сист') === 0) return 'Система';
  if (s.indexOf('блок') === 0) return 'Блокада';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function splitProcs_(text) {
  return String(text).split(/[,;+\/]/).map(normalizeProc_).filter(String);
}

function isConsultFilled_(c) {
  return !!(c.name || c.phone || c.manager || c.service || c.comment);
}

/* ---------- Клиентке арналған функциялар ---------- */

/** Бастапқы деректер: күндер тізімі, бүгінгі күн, менеджерлер, пациенттер. */
function getInit() {
  var days = daySheets_();
  var managers = {}, patients = {}, procs = {};
  CFG.DEFAULT_MANAGERS.forEach(function (m) { managers[m] = 1; });
  CFG.DEFAULT_PROCEDURES.forEach(function (p) { procs[p] = 1; });
  days.slice(-30).forEach(function (d) {
    var data = dayData_(d.sheet);
    data.consults.forEach(function (c) { if (c.manager) managers[c.manager] = 1; });
    data.treatments.forEach(function (g) {
      g.rows.forEach(function (t) {
        if (t.name) patients[t.name] = 1;
        splitProcs_(t.proc).forEach(function (p) { procs[p] = 1; });
      });
    });
  });
  var today = todayIso_();
  var current = null;
  days.forEach(function (d) { if (d.date <= today) current = d.name; });
  if (!current && days.length) current = days[0].name;
  return {
    days: days.map(function (d) { return { name: d.name, date: d.date }; }),
    today: today,
    current: current,
    managers: Object.keys(managers).sort(),
    patients: Object.keys(patients).sort(),
    procedures: Object.keys(procs).sort()
  };
}

function getDay(name) {
  return dayData_(sheetByName_(name));
}

/**
 * Консультацияны сақтау. `expected` — пайдаланушы көрген ескі мәндер:
 * әлдекім бұл уақытта жазбаны өзгертіп үлгерсе, үстінен жазбаймыз.
 */
function saveConsult(dayName, row, data, expected) {
  return withLock_(function () {
    var sheet = sheetByName_(dayName);
    var grid = readGrid_(sheet);
    if (parseTime_(cell_(grid, row, COL.A)) === null) throw new Error('Бұл жол консультация уақыты емес');
    var current = CONSULT_FIELDS.map(function (f, i) { return cell_(grid, row, COL.B + i); });
    if (expected) {
      var exp = CONSULT_FIELDS.map(function (f) { return String(expected[f] || '').trim(); });
      if (exp.join('\u0001') !== current.join('\u0001')) {
        return { ok: false, conflict: true, day: dayData_(sheet) };
      }
    }
    var values = CONSULT_FIELDS.map(function (f) { return String((data && data[f]) || '').trim(); });
    var hasAny = values.some(String);
    if (hasAny && !values[0] && !values[1]) throw new Error('Пациенттің аты немесе номері керек');
    if (hasAny && !values[3]) throw new Error('Жазған менеджерді көрсетіңіз');
    sheet.getRange(row, COL.B + 1, 1, CONSULT_FIELDS.length).setValues([values]);
    return { ok: true, day: dayData_(sheet) };
  });
}

/** Ем жолын сақтау/өзгерту/тазалау (бар жолға). */
function saveTreatment(dayName, row, data, expected) {
  return withLock_(function () {
    var sheet = sheetByName_(dayName);
    var grid = readGrid_(sheet);
    if (!findTreatmentRow_(grid, row)) throw new Error('Бұл жол ем кестесіне жатпайды');
    var cur = [cell_(grid, row, COL.K), cell_(grid, row, COL.L)];
    if (expected && (String(expected.name || '').trim() !== cur[0] || String(expected.proc || '').trim() !== cur[1])) {
      return { ok: false, conflict: true, day: dayData_(sheet) };
    }
    var vals = [String((data && data.name) || '').trim(), String((data && data.proc) || '').trim()];
    if (vals[1] && !vals[0]) throw new Error('Пациенттің атын жазыңыз');
    sheet.getRange(row, COL.K + 1, 1, 2).setValues([vals]);
    return { ok: true, day: dayData_(sheet) };
  });
}

/** Уақыт тобына жаңа ем жазбасын қосу: топтағы бірінші бос жолға жазылады. */
function addTreatment(dayName, groupRow, data) {
  return withLock_(function () {
    var sheet = sheetByName_(dayName);
    var grid = readGrid_(sheet);
    var group = treatmentGroups_(grid).filter(function (g) { return g.row === groupRow; })[0];
    if (!group) throw new Error('Уақыт тобы табылмады');
    var name = String((data && data.name) || '').trim();
    var proc = String((data && data.proc) || '').trim();
    if (!name) throw new Error('Пациенттің атын жазыңыз');
    var free = group.rows.filter(function (r) { return !r.name && !r.proc; })[0];
    if (!free) throw new Error(group.time + ' уақытында бос орын жоқ. Көрші уақытты таңдаңыз.');
    sheet.getRange(free.row, COL.K + 1, 1, 2).setValues([[name, proc]]);
    return { ok: true, day: dayData_(sheet) };
  });
}

function findTreatmentRow_(grid, row) {
  var groups = treatmentGroups_(grid);
  for (var i = 0; i < groups.length; i++) {
    for (var j = 0; j < groups[i].rows.length; j++) {
      if (groups[i].rows[j].row === row) return groups[i].rows[j];
    }
  }
  return null;
}

/** Жаңа күн парағы: шаблоннан көшіріп, жазбаларды тазалайды. iso = "2026-11-19". */
function createDay(iso) {
  return withLock_(function () {
    var m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error('Күн дұрыс емес');
    var name = (+m[3]) + '.' + (+m[2]) + '.' + m[1];
    var days = daySheets_();
    if (days.some(function (d) { return d.date === iso; })) throw new Error(name + ' парағы бұрыннан бар');
    var ss = ss_();
    var template = ss.getSheetByName(CFG.TEMPLATE_NAME) || (days.length ? days[days.length - 1].sheet : null);
    if (!template) throw new Error('Шаблон парақ табылмады');
    var sh = template.copyTo(ss).setName(name);
    sh.getRange(CFG.FIRST_ROW, COL.B + 1, CFG.LAST_ROW - CFG.FIRST_ROW + 1, CONSULT_FIELDS.length).clearContent();
    sh.getRange(CFG.FIRST_ROW, COL.K + 1, CFG.LAST_ROW - CFG.FIRST_ROW + 1, 2).clearContent();
    // Парақты күн ретімен орналастыру
    var before = days.filter(function (d) { return d.date < iso; });
    var pos = before.length ? before[before.length - 1].sheet.getIndex() + 1 : 1;
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(pos);
    return { ok: true, name: name, init: getInit() };
  });
}

/** Есеп: from/to = "yyyy-MM-dd" (қоса алғанда). */
function getStats(from, to) {
  var days = daySheets_().filter(function (d) { return d.date >= from && d.date <= to; });
  var res = {
    from: from, to: to, days: [],
    consult: { total: 0, primary: 0, repeat: 0, other: 0, cancelled: 0 },
    managers: {}, procedures: {}, patients: {}, treatTotal: 0
  };
  days.forEach(function (d) {
    var data = dayData_(d.sheet);
    var dc = 0, dt = 0;
    data.consults.forEach(function (c) {
      if (!isConsultFilled_(c)) return;
      dc++;
      res.consult.total++;
      var svc = c.service.toLowerCase();
      if (svc.indexOf('перв') === 0) res.consult.primary++;
      else if (svc.indexOf('повт') === 0) res.consult.repeat++;
      else res.consult.other++;
      if (c.comment.indexOf('❌') >= 0) res.consult.cancelled++;
      var mg = c.manager || '(көрсетілмеген)';
      res.managers[mg] = (res.managers[mg] || 0) + 1;
    });
    data.treatments.forEach(function (g) {
      g.rows.forEach(function (t) {
        if (!t.name) return;
        dt++;
        res.treatTotal++;
        res.patients[t.name] = (res.patients[t.name] || 0) + 1;
        var ps = splitProcs_(t.proc);
        if (!ps.length) ps = ['(көрсетілмеген)'];
        ps.forEach(function (p) { res.procedures[p] = (res.procedures[p] || 0) + 1; });
      });
    });
    res.days.push({ name: d.name, date: d.date, consults: dc, treatments: dt });
  });
  return res;
}

function withLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(15000)) throw new Error('Кесте бос емес, біраздан соң қайталаңыз');
  try {
    var r = fn();
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}
