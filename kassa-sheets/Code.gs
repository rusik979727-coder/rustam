/**
 * BELES · Касса — Google таблицамен тікелей жұмыс істейтін приложение.
 *
 * Деректер осы скрипт байланған таблицада сақталады:
 *   «Пациенттер»: A аты-жөні, B ем басталған күні, C ем аяқталған күні, F ем құны, M ескертпе
 *                 (D, E, G–L, N–P бағандарында формулалар, оларға скрипт жазбайды).
 *   «Төлемдер»:   A күні, B уақыты, C пациент, D түрі, E тәсілі, F сома, G ескертпе
 *                 (H–I бағандарында формулалар).
 *   «Расход»:     A күні, B санат, C сома, D тәсілі, E ескертпе.
 */

var SH_PATIENTS = 'Пациенттер';
var SH_PAYMENTS = 'Төлемдер';
var SH_EXPENSES = 'Расход';
var KIND_TO_SHEET = { consult: 'Консультация', treatment: 'Ем' };
var METHODS = ['Қолма-қол', 'Kaspi QR', 'Kaspi аударым', 'Карта', 'Аударым'];
var CATEGORIES = ['Дәрі-дәрмек', 'Медициналық материалдар', 'Жалақы', 'Аренда', 'Коммуналдық', 'Құрал-жабдық', 'Жарнама', 'Салық', 'Басқа'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('BELES · Касса')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

// ---------- helpers ----------

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Таблицада «' + name + '» парағы табылмады.');
  return sh;
}

function key_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toLowerCase(); }
function clean_(s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' '); }

/** 'yyyy-MM-dd' → таблицаның уақыт белдеуіндегі сол күннің басы (Date). */
function isoToDate_(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) throw new Error('Күн дұрыс емес: ' + iso);
  return Utilities.parseDate(iso, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

/** 'HH:mm' → тәуліктің бөлігі. */
function timeToSerial_(t) {
  var m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  return (+m[1] * 60 + +m[2]) / 1440;
}

/** Таблицадан оқылған күн мәнін 'yyyy-MM-dd' түріне келтіреді. */
function cellToIso_(v, display, tz) {
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  if (typeof v === 'number' && v > 0) {
    var d = new Date(Math.round((v - 25569) * 86400000));
    return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  }
  var s = String(display || v || '').trim();
  var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return '';
}

function cellToTime_(display) {
  var m = /(\d{1,2}):(\d{2})/.exec(String(display || ''));
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function num_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v || '').replace(/[\s ]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

/** Деректер бар соңғы жол (тек көрсетілген бағандар бойынша; формулалы бағандар есептелмейді). */
function lastDataRow_(sh, cols) {
  var max = sh.getMaxRows();
  if (max < 2) return 1;
  var vals = sh.getRange(2, 1, max - 1, cols).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    for (var j = 0; j < cols; j++) if (vals[i][j] !== '' && vals[i][j] !== null) return i + 2;
  }
  return 1;
}

/** Жаңа жолдар қосып, формулаларды 2-жолдан көшіреді (парақ толып қалса). */
function grow_(sh, formulaCols, count) {
  var max = sh.getMaxRows();
  sh.insertRowsAfter(max, count);
  formulaCols.forEach(function (c) {
    sh.getRange(2, c[0], 1, c[1]).copyTo(sh.getRange(max + 1, c[0], count, c[1]));
  });
}

function withLock_(fn) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) throw new Error('Таблица бос емес, бірнеше секундтан соң қайталаңыз.');
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}

// ---------- read ----------

function readPatients_(tz) {
  var sh = sheet_(SH_PATIENTS);
  var last = lastDataRow_(sh, 1);
  if (last < 2) return [];
  var rng = sh.getRange(2, 1, last - 1, 13);
  var v = rng.getValues(), d = rng.getDisplayValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var name = clean_(v[i][0]);
    if (!name) continue;
    out.push({
      row: i + 2,
      name: name,
      start: cellToIso_(v[i][1], d[i][1], tz),
      end: cellToIso_(v[i][2], d[i][2], tz),
      treatmentCost: num_(v[i][5]),
      note: String(v[i][12] || '')
    });
  }
  return out;
}

function readPayments_(tz) {
  var sh = sheet_(SH_PAYMENTS);
  var last = lastDataRow_(sh, 7);
  if (last < 2) return [];
  var rng = sh.getRange(2, 1, last - 1, 7);
  var v = rng.getValues(), d = rng.getDisplayValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var name = clean_(v[i][2]);
    var date = cellToIso_(v[i][0], d[i][0], tz);
    if (!name || !date) continue;
    out.push({
      row: i + 2,
      date: date,
      time: cellToTime_(d[i][1]),
      patientName: name,
      kind: String(v[i][3]).trim() === 'Ем' ? 'treatment' : 'consult',
      method: String(v[i][4] || ''),
      amount: num_(v[i][5]),
      note: String(v[i][6] || '')
    });
  }
  return out;
}

function readExpenses_(tz) {
  var sh = sheet_(SH_EXPENSES);
  var last = lastDataRow_(sh, 5);
  if (last < 2) return [];
  var rng = sh.getRange(2, 1, last - 1, 5);
  var v = rng.getValues(), d = rng.getDisplayValues();
  var out = [];
  for (var i = 0; i < v.length; i++) {
    var date = cellToIso_(v[i][0], d[i][0], tz);
    if (!date || v[i][2] === '') continue;
    out.push({
      row: i + 2,
      date: date,
      category: String(v[i][1] || ''),
      amount: num_(v[i][2]),
      method: String(v[i][3] || ''),
      note: String(v[i][4] || '')
    });
  }
  return out;
}

/** Приложение ашылғанда және әр 30 секунд сайын шақырылады. */
function getData() {
  var tz = ss_().getSpreadsheetTimeZone();
  return {
    patients: readPatients_(tz),
    payments: readPayments_(tz),
    expenses: readExpenses_(tz),
    url: ss_().getUrl(),
    user: (Session.getActiveUser && Session.getActiveUser().getEmail()) || '',
    loadedAt: new Date().getTime()
  };
}

// ---------- patients ----------

function findPatientRow_(sh, name) {
  var last = lastDataRow_(sh, 1);
  if (last < 2) return 0;
  var vals = sh.getRange(2, 1, last - 1, 1).getValues();
  var k = key_(name);
  for (var i = 0; i < vals.length; i++) if (key_(vals[i][0]) === k) return i + 2;
  return 0;
}

function firstFreePatientRow_(sh) {
  var max = sh.getMaxRows();
  var vals = sh.getRange(2, 1, max - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (String(vals[i][0]).trim() === '') return i + 2;
  grow_(sh, [[4, 2], [7, 6], [14, 3]], 200);
  return max + 1;
}

function writePatientFields_(sh, row, p) {
  if ('start' in p || 'end' in p) {
    var b = sh.getRange(row, 2, 1, 2);
    var cur = b.getValues()[0];
    b.setValues([[
      'start' in p ? (p.start ? isoToDate_(p.start) : '') : cur[0],
      'end' in p ? (p.end ? isoToDate_(p.end) : '') : cur[1]
    ]]);
  }
  if ('treatmentCost' in p) {
    var c = Number(p.treatmentCost);
    sh.getRange(row, 6).setValue(c > 0 ? c : '');
  }
  if ('note' in p) sh.getRange(row, 13).setValue(String(p.note || ''));
}

function checkDates_(p) {
  if (p.start && p.end && p.end < p.start) throw new Error('Ем аяқталған күні басталған күнінен ерте болмауы керек.');
}

/** Пациентті табады, болмаса қосады. Қайтарады: жол нөмірі. */
function ensurePatient_(sh, name, patch) {
  var row = findPatientRow_(sh, name);
  if (!row) {
    row = firstFreePatientRow_(sh);
    sh.getRange(row, 1).setValue(clean_(name));
  }
  if (patch) writePatientFields_(sh, row, patch);
  return row;
}

function savePatient(name, patch) {
  name = clean_(name);
  if (!name) throw new Error('Пациенттің аты-жөні жазылмаған.');
  patch = patch || {};
  checkDates_(patch);
  return withLock_(function () {
    ensurePatient_(sheet_(SH_PATIENTS), name, patch);
    return getData();
  });
}

function removePatient(name) {
  return withLock_(function () {
    var sh = sheet_(SH_PATIENTS);
    var row = findPatientRow_(sh, name);
    if (!row) return getData();
    var pays = readPayments_(ss_().getSpreadsheetTimeZone());
    var k = key_(name);
    if (pays.some(function (x) { return key_(x.patientName) === k; })) {
      throw new Error('Бұл пациенттің төлемдері бар, алдымен оларды өшіріңіз.');
    }
    sh.getRange(row, 1, 1, 3).clearContent();
    sh.getRange(row, 6).clearContent();
    sh.getRange(row, 13).clearContent();
    return getData();
  });
}

// ---------- payments ----------

function sortPayments_(sh) {
  var last = lastDataRow_(sh, 7);
  if (last > 2) sh.getRange(2, 1, last - 1, 7).sort([{ column: 1, ascending: true }, { column: 2, ascending: true }]);
}

/**
 * rec: { name, kind: 'consult'|'treatment', date: 'yyyy-MM-dd', time: 'HH:mm',
 *        parts: [{ method, amount }], note, patient: { treatmentCost?, start?, end? } }
 */
function addPayment(rec) {
  var name = clean_(rec && rec.name);
  if (!name) throw new Error('Пациенттің аты-жөні жазылмаған.');
  if (!KIND_TO_SHEET[rec.kind]) throw new Error('Төлем түрі белгісіз.');
  var parts = (rec.parts || []).filter(function (q) { return Number(q.amount) > 0; });
  if (!parts.length) throw new Error('Сома жазылмаған.');
  parts.forEach(function (q) { if (METHODS.indexOf(q.method) < 0) throw new Error('Төлем тәсілі белгісіз: ' + q.method); });
  var dateValue = isoToDate_(rec.date);
  var timeSerial = timeToSerial_(rec.time);
  var patch = rec.patient || {};
  checkDates_(patch);

  return withLock_(function () {
    ensurePatient_(sheet_(SH_PATIENTS), name, patch);
    var sh = sheet_(SH_PAYMENTS);
    var start = lastDataRow_(sh, 7) + 1;
    var need = start + parts.length - 1 - sh.getMaxRows();
    if (need > 0) grow_(sh, [[8, 2]], Math.max(need, 500));
    var note = String(rec.note || '').trim();
    var rows = parts.map(function (q, i) {
      var n = parts.length > 1 ? (note ? note + '; ' : '') + 'бөліп төледі (' + (i + 1) + '/' + parts.length + ')' : note;
      return [dateValue, timeSerial, name, KIND_TO_SHEET[rec.kind], q.method, Number(q.amount), n];
    });
    sh.getRange(start, 1, rows.length, 7).setValues(rows);
    sortPayments_(sh);
    return getData();
  });
}

/** Жол нөмірі сұрыптаудан кейін өзгеруі мүмкін, сондықтан жазбаны мазмұны бойынша іздейміз. */
function removePayment(x) {
  return withLock_(function () {
    var sh = sheet_(SH_PAYMENTS);
    var list = readPayments_(ss_().getSpreadsheetTimeZone());
    var same = function (p) {
      return p.date === x.date && p.time === x.time && key_(p.patientName) === key_(x.patientName) &&
        p.kind === x.kind && p.method === x.method && p.amount === Number(x.amount) && p.note === x.note;
    };
    var hit = list.filter(function (p) { return p.row === x.row && same(p); })[0] || list.filter(same)[0];
    if (!hit) throw new Error('Бұл төлем таблицада өзгерген немесе өшірілген. Тізім жаңартылды.');
    sh.getRange(hit.row, 1, 1, 7).clearContent();
    sortPayments_(sh);
    return getData();
  });
}

// ---------- expenses ----------

function sortExpenses_(sh) {
  var last = lastDataRow_(sh, 5);
  if (last > 2) sh.getRange(2, 1, last - 1, 5).sort([{ column: 1, ascending: true }]);
}

function addExpense(x) {
  var amount = Number(x && x.amount);
  if (!(amount > 0)) throw new Error('Сома жазылмаған.');
  if (CATEGORIES.indexOf(x.category) < 0) throw new Error('Санат белгісіз.');
  var row = [isoToDate_(x.date), x.category, amount, METHODS.indexOf(x.method) >= 0 ? x.method : '', String(x.note || '').trim()];
  return withLock_(function () {
    var sh = sheet_(SH_EXPENSES);
    var r = lastDataRow_(sh, 5) + 1;
    if (r > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 500);
    sh.getRange(r, 1, 1, 5).setValues([row]);
    sortExpenses_(sh);
    return getData();
  });
}

function removeExpense(x) {
  return withLock_(function () {
    var sh = sheet_(SH_EXPENSES);
    var list = readExpenses_(ss_().getSpreadsheetTimeZone());
    var same = function (p) {
      return p.date === x.date && p.category === x.category && p.amount === Number(x.amount) && p.method === x.method && p.note === x.note;
    };
    var hit = list.filter(function (p) { return p.row === x.row && same(p); })[0] || list.filter(same)[0];
    if (!hit) throw new Error('Бұл расход таблицада өзгерген немесе өшірілген. Тізім жаңартылды.');
    sh.getRange(hit.row, 1, 1, 5).clearContent();
    sortExpenses_(sh);
    return getData();
  });
}
