// Белес График. Бұл файл автоматты түрде жиналған (scripts/bundle.js).
// Өзгерту керек болса, apps-script/ ішіндегі түпнұсқаларды өзгертіп, npm run bundle іске қосыңыз.

// ════════ Code.gs ════════
/**
 * @OnlyCurrentDoc  (скрипт тек осы таблицаға ғана қол жеткізеді)
 *
 * Белес График — Google таблицамен тікелей жұмыс істейтін веб-приложение.
 * Бұл скрипт таблицаның өзіне байланады (Кеңейтімдер → Apps Script).
 * Клиент функцияларды google.script.run арқылы шақырады.
 * Атауы "_" белгісімен аяқталатын функциялар клиентке ашық емес.
 */

var CONFIG = {
  appTitle: 'Белес График',
  // Жаңа күн осы атаулы парақтан көшіріледі. Ондай парақ болмаса — соңғы күннен.
  templateSheetName: 'Шаблон',
  lockTimeoutMs: 15000
};

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle(CONFIG.appTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** HTML шаблонына басқа файлды қосу үшін: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

// ───────────────────────── Ішкі көмекшілер ─────────────────────────

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function tz_() {
  return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone();
}

function todayIso_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

/** Барлық күн парақтары, күні бойынша сұрыпталған. Бір күнге екі парақ болса — біріншісі. */
function dateSheets_() {
  var seen = {};
  var list = [];
  ss_().getSheets().forEach(function (sh, index) {
    var iso = parseSheetName(sh.getName());
    if (!iso || seen[iso]) return;
    seen[iso] = true;
    list.push({ sheet: sh.getName(), date: iso, index: index });
  });
  list.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  return list;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('«' + name + '» парағы табылмады. Тізімді жаңартып көріңіз.');
  return sh;
}

function readSheet_(sh) {
  var lastRow = Math.max(sh.getLastRow(), LAYOUT.defaultHeaderRow + 1);
  var values = sh.getRange(1, 1, lastRow, LAYOUT.readCols).getDisplayValues();
  var merges = sh.getRange(1, LAYOUT.physio.time, lastRow, 1).getMergedRanges().map(function (r) {
    return { start: r.getRow(), end: r.getLastRow() };
  });
  return { values: values, merges: merges };
}

/** Dropdown тізімдерін таблицаның өзіндегі validation-нан оқиды. */
function readOptions_(sh, row) {
  var C = LAYOUT.doctor;
  var out = {};
  ['recorder', 'source', 'service', 'attended'].forEach(function (field) {
    var list = null;
    try {
      var rule = sh.getRange(row, C[field]).getDataValidation();
      if (rule && String(rule.getCriteriaType()) === 'VALUE_IN_LIST') {
        list = rule.getCriteriaValues()[0].map(String).filter(function (v) { return v.trim(); });
      }
    } catch (e) {
      list = null;
    }
    out[field] = list && list.length ? list : DEFAULT_OPTIONS[field].slice();
  });
  return out;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.lockTimeoutMs)) {
    throw new Error('Таблицаны қазір басқа адам өзгертіп жатыр. Бірнеше секундтан кейін қайталаңыз.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function currentRowSnapshot_(sh, row, kind) {
  var values = [];
  values[row - 1] = sh.getRange(row, 1, 1, LAYOUT.readCols).getDisplayValues()[0];
  return rowSnapshot(values, row, kind);
}

/** Таблица "+7…" немесе "=…" мәтінін формула деп қабылдамауы үшін алдына апостроф қояды. */
function safeCell_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function assertUnchanged_(sh, row, kind, prev) {
  if (prev == null) return;
  if (currentRowSnapshot_(sh, row, kind) !== prev) {
    throw new Error('CONFLICT: Бұл жолды сіз ашқаннан кейін басқа адам өзгертті. Кесте жаңартылды — қайта тексеріңіз.');
  }
}

function assertDoctorRow_(sh, row) {
  var day = parseDay(readSheet_(sh).values, []);
  var ok = day.doctor.some(function (s) { return s.row === row; });
  if (!ok) throw new Error('Бұл жолда дәрігер уақыты жоқ (жол ' + row + ').');
}

function assertPhysioRow_(sh, row) {
  var data = readSheet_(sh);
  var day = parseDay(data.values, data.merges);
  var ok = day.physio.some(function (b) {
    var last = b.places.length ? b.places[b.places.length - 1].row : b.startRow;
    var blockEnd = Math.max(last, b.startRow + LAYOUT.physioBlockSize - 1);
    return row >= b.startRow && row <= blockEnd;
  });
  if (!ok) throw new Error('Бұл жол физио кестесіне жатпайды (жол ' + row + ').');
}

function cleanText_(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 200);
}

function checkOption_(options, field, value, label) {
  if (value && options[field].indexOf(value) === -1) {
    throw new Error('«' + label + '» өрісіне таблицада жоқ мән берілді: ' + value);
  }
}

function doctorRowValues_(sh, row, data) {
  var options = readOptions_(sh, row);
  var clean = {
    name: cleanText_(data.name, 120),
    phone: data.phone ? normalizePhone(data.phone).display : '',
    comment: cleanText_(data.comment, 300),
    recorder: cleanText_(data.recorder),
    source: cleanText_(data.source),
    service: cleanText_(data.service),
    attended: cleanText_(data.attended)
  };
  if (!clean.name && !clean.phone) throw new Error('Пациенттің атын немесе телефонын енгізіңіз.');
  if (!clean.recorder) throw new Error('Қай менеджер жазғанын таңдаңыз.');
  checkOption_(options, 'recorder', clean.recorder, 'Жазған');
  checkOption_(options, 'source', clean.source, 'Қайдан келді');
  checkOption_(options, 'service', clean.service, 'Қызмет');
  checkOption_(options, 'attended', clean.attended, 'Келді ме');
  return LAYOUT.doctorFields.map(function (f) { return safeCell_(clean[f]); });
}

// ───────────────────────── Клиентке ашық API ─────────────────────────

/** Бастапқы деректер: күндер тізімі және бүгінгі күн. */
function getBootstrap() {
  return {
    title: ss_().getName(),
    url: ss_().getUrl(),
    today: todayIso_(),
    days: dateSheets_().map(function (d) { return { sheet: d.sheet, date: d.date }; })
  };
}

/** Бір күннің толық кестесі. */
function getDay(sheetName) {
  var sh = sheet_(sheetName);
  var data = readSheet_(sh);
  var day = parseDay(data.values, data.merges);
  var firstSlotRow = day.doctor.length ? day.doctor[0].row : day.headerRow + 1;
  var procs = {};
  day.physio.forEach(function (b) {
    b.places.forEach(function (p) { if (p.proc) procs[p.proc] = true; });
  });
  var procList = TREATMENTS.slice();
  Object.keys(procs).sort().forEach(function (p) { if (procList.indexOf(p) === -1) procList.push(p); });
  return {
    sheet: sheetName,
    date: parseSheetName(sheetName),
    doctor: day.doctor,
    physio: day.physio,
    options: readOptions_(sh, firstSlotRow),
    procedures: procList,
    loadedAt: new Date().toISOString()
  };
}

/** Дәрігер слотына жазу немесе жазбаны өзгерту. */
function saveAppointment(sheetName, row, data, prev) {
  return withLock_(function () {
    var sh = sheet_(sheetName);
    assertDoctorRow_(sh, row);
    assertUnchanged_(sh, row, 'doctor', prev);
    var values = doctorRowValues_(sh, row, data);
    sh.getRange(row, LAYOUT.doctor.name, 1, values.length).setValues([values]);
    return getDay(sheetName);
  });
}

/** Жазбаны өшіру (тек мәндер тазаланады, dropdown пен формат қалады). */
function clearAppointment(sheetName, row, prev) {
  return withLock_(function () {
    var sh = sheet_(sheetName);
    assertDoctorRow_(sh, row);
    assertUnchanged_(sh, row, 'doctor', prev);
    sh.getRange(row, LAYOUT.doctor.name, 1, LAYOUT.doctorFields.length).clearContent();
    return getDay(sheetName);
  });
}

/** Келді (✅) / келмеді (❌) / белгісіз (''). */
function setAttendance(sheetName, row, value, prev) {
  return withLock_(function () {
    var sh = sheet_(sheetName);
    assertDoctorRow_(sh, row);
    assertUnchanged_(sh, row, 'doctor', prev);
    var options = readOptions_(sh, row);
    checkOption_(options, 'attended', value, 'Келді ме');
    var cell = sh.getRange(row, LAYOUT.doctor.attended);
    if (value) cell.setValue(value); else cell.clearContent();
    return getDay(sheetName);
  });
}

/** Жазбаны басқа уақытқа (басқа күнге де) көшіру. Мақсатты слот бос болуы керек. */
function moveAppointment(fromSheet, fromRow, toSheet, toRow, prev) {
  return withLock_(function () {
    var src = sheet_(fromSheet);
    var dst = sheet_(toSheet);
    assertDoctorRow_(src, fromRow);
    assertDoctorRow_(dst, toRow);
    if (fromSheet === toSheet && fromRow === toRow) return getDay(fromSheet);
    assertUnchanged_(src, fromRow, 'doctor', prev);
    var target = currentRowSnapshot_(dst, toRow, 'doctor').split('␟');
    if (target[0] || target[1]) {
      throw new Error('CONFLICT: Таңдалған уақыт бос емес. Басқа уақытты таңдаңыз.');
    }
    var n = LAYOUT.doctorFields.length;
    var values = src.getRange(fromRow, LAYOUT.doctor.name, 1, n).getValues().map(function (r) {
      return r.map(function (v) { return typeof v === 'string' ? safeCell_(v) : v; });
    });
    dst.getRange(toRow, LAYOUT.doctor.name, 1, n).setValues(values);
    src.getRange(fromRow, LAYOUT.doctor.name, 1, n).clearContent();
    return getDay(fromSheet);
  });
}

/** Физио орнына жазу; data.name бос болса — орын босатылады. */
function savePhysio(sheetName, row, data, prev) {
  return withLock_(function () {
    var sh = sheet_(sheetName);
    assertPhysioRow_(sh, row);
    assertUnchanged_(sh, row, 'physio', prev);
    var name = cleanText_(data && data.name, 120);
    var proc = cleanText_(data && data.proc, 120);
    var range = sh.getRange(row, LAYOUT.physio.name, 1, 2);
    if (!name && !proc) range.clearContent(); else range.setValues([[safeCell_(name), safeCell_(proc)]]);
    return getDay(sheetName);
  });
}

/**
 * Жаңа күн парағын жасау. Үлгі ретінде «Шаблон» парағы, ол болмаса соңғы күн алынады;
 * пациенттер өшіріледі, ал уақыттар, dropdown-тар, түстер мен біріктірулер сақталады.
 */
function createDay(iso) {
  return withLock_(function () {
    parseSheetName(formatSheetName(iso)); // форматты тексеру
    var existing = dateSheets_().filter(function (d) { return d.date === iso; })[0];
    if (existing) return { sheet: existing.sheet, created: false };

    var ss = ss_();
    var days = dateSheets_();
    var template = ss.getSheetByName(CONFIG.templateSheetName);
    if (!template) {
      if (!days.length) throw new Error('Үлгі ретінде алатын күн парағы жоқ. «Шаблон» парағын жасаңыз.');
      var before = days.filter(function (d) { return d.date < iso; });
      template = ss.getSheetByName((before.length ? before[before.length - 1] : days[days.length - 1]).sheet);
    }

    var position = 0;
    days.forEach(function (d) { if (d.date < iso) position = Math.max(position, d.index + 1); });
    var name = formatSheetName(iso);
    var sh = ss.insertSheet(name, position, { template: template });

    var data = readSheet_(sh);
    var day = parseDay(data.values, data.merges);
    day.doctor.forEach(function (s) {
      sh.getRange(s.row, LAYOUT.doctor.name, 1, LAYOUT.doctorFields.length).clearContent();
    });
    var last = data.values.length;
    if (last > day.headerRow) {
      sh.getRange(day.headerRow + 1, LAYOUT.physio.name, last - day.headerRow, 2).clearContent();
    }
    return { sheet: name, created: true };
  });
}

/** Пациентті барлық күндерден іздеу (аты немесе телефоны бойынша). */
function searchPatient(query) {
  var q = String(query || '').trim();
  if (q.length < 2) return [];
  var results = [];
  dateSheets_().forEach(function (d) {
    var data = readSheet_(sheet_(d.sheet));
    var day = parseDay(data.values, data.merges);
    day.doctor.forEach(function (s) {
      if (s.booked && matchesQuery(q, s.name, s.phoneDigits)) {
        results.push({ kind: 'doctor', sheet: d.sheet, date: d.date, time: s.time, row: s.row,
          name: s.name, phone: s.phone, phoneDigits: s.phoneDigits, service: s.service,
          attended: s.attended, comment: s.comment, source: s.source });
      }
    });
    day.physio.forEach(function (b) {
      b.places.forEach(function (p) {
        if (p.name && matchesQuery(q, p.name, '')) {
          results.push({ kind: 'physio', sheet: d.sheet, date: d.date, time: b.time, row: p.row,
            name: p.name, service: p.proc });
        }
      });
    });
  });
  results.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.time < b.time ? -1 : 1;
  });
  return results.slice(0, 200);
}

/** Кезең бойынша статистика (екі шеті қоса). */
function getStats(fromIso, toIso) {
  var acc = emptyStats();
  dateSheets_().forEach(function (d) {
    if (d.date < fromIso || d.date > toIso) return;
    var data = readSheet_(sheet_(d.sheet));
    accumulateStats(acc, d.date, parseDay(data.values, data.merges));
  });
  acc.from = fromIso;
  acc.to = toIso;
  return acc;
}

// ════════ Sheet.gs ════════
/**
 * Күн парағының құрылымын оқитын таза функциялар.
 *
 * Парақ құрылымы (нақты таблицадан):
 *   2-жол — тақырып: | (уақыт) | ФИ пациента | номер | коммент | записал | источник | услуга | пд |
 *   A бағаны — дәрігер қабылдауының 20 минуттық слоттары (9:00 … 18:30, 19).
 *   J бағаны — физио уақыты (8:30 … 19:30), әр уақыт 3 жолға біріктірілген → 3 орын.
 *   K — физиоға жазылған адамның аты, L — процедура.
 */

var LAYOUT = {
  headerMarker: 'ФИ пациента',
  defaultHeaderRow: 2,
  doctor: { time: 1, name: 2, phone: 3, comment: 4, recorder: 5, source: 6, service: 7, attended: 8 },
  doctorFields: ['name', 'phone', 'comment', 'recorder', 'source', 'service', 'attended'],
  physio: { time: 10, name: 11, proc: 12 },
  physioFields: ['name', 'proc'],
  physioBlockSize: 3,
  readCols: 12
};

// Ем түрлері: батырма ретінде әрқашан көрсетіледі. Таблицада кездескен басқа түрлер соңынан қосылады.
var TREATMENTS = ['Физио', 'Плазма'];

// Validation табылмаса қолданылатын тізімдер (таблицадағы dropdown-тардың көшірмесі).
var DEFAULT_OPTIONS = {
  recorder: ['Гулназ', 'Асель', 'Айсулу'],
  source: ['Таргет', '2ГИС', 'По рек'],
  service: ['первичный', 'повторный', 'курс'],
  attended: ['✅', '❌']
};

function cell_(values, row, col) {
  var r = values[row - 1];
  if (!r) return '';
  var v = r[col - 1];
  return v == null ? '' : String(v).trim();
}

/** Тақырып жолын табады (B бағанында "ФИ пациента" тұрған жол). */
function findHeaderRow(values) {
  for (var i = 0; i < Math.min(values.length, 10); i++) {
    if (cell_(values, i + 1, LAYOUT.doctor.name) === LAYOUT.headerMarker) return i + 1;
  }
  return LAYOUT.defaultHeaderRow;
}

/** Дәрігер слоттары: A бағанында уақыт тұрған әр жол. */
function parseDoctorSlots(values, headerRow) {
  var C = LAYOUT.doctor;
  var slots = [];
  for (var row = headerRow + 1; row <= values.length; row++) {
    var minutes = parseTime(cell_(values, row, C.time));
    if (minutes === null) continue;
    var phone = normalizePhone(cell_(values, row, C.phone));
    var slot = {
      row: row,
      time: formatMinutes(minutes),
      minutes: minutes,
      name: cell_(values, row, C.name),
      phone: phone.display,
      phoneDigits: phone.digits,
      comment: cell_(values, row, C.comment),
      recorder: cell_(values, row, C.recorder),
      source: cell_(values, row, C.source),
      service: cell_(values, row, C.service),
      attended: cell_(values, row, C.attended)
    };
    slot.booked = Boolean(slot.name || slot.phone);
    slot.prev = rowSnapshot(values, row, 'doctor');
    slots.push(slot);
  }
  return sortByTime_(slots);
}

/**
 * Физио блоктары. merges — J бағанындағы біріктірулер [{start, end}] (жол нөмірлері).
 * Біріктіру болмаса, блок 3 жолдан тұрады деп есептеледі. Блоктар арасындағы
 * бос жолдарда біреу жазылып қойса, ол алдыңғы блоктың қосымша орны болып көрінеді.
 */
function parsePhysioBlocks(values, headerRow, merges) {
  var C = LAYOUT.physio;
  var mergeEnd = {};
  (merges || []).forEach(function (m) { mergeEnd[m.start] = m.end; });

  var timeRows = [];
  for (var row = headerRow + 1; row <= values.length; row++) {
    var minutes = parseTime(cell_(values, row, C.time));
    if (minutes !== null) timeRows.push({ row: row, minutes: minutes });
  }

  return sortByTime_(timeRows.map(function (t, i) {
    var nextStart = i + 1 < timeRows.length ? timeRows[i + 1].row : values.length + 1;
    var end = mergeEnd[t.row] || (t.row + LAYOUT.physioBlockSize - 1);
    end = Math.max(t.row, Math.min(end, nextStart - 1));
    var places = [];
    for (var r = t.row; r < nextStart; r++) {
      var name = cell_(values, r, C.name);
      var proc = cell_(values, r, C.proc);
      var inBlock = r <= end;
      if (!inBlock && !name && !proc) continue;
      places.push({ row: r, name: name, proc: proc, extra: !inBlock, prev: rowSnapshot(values, r, 'physio') });
    }
    return {
      time: formatMinutes(t.minutes),
      minutes: t.minutes,
      startRow: t.row,
      places: places,
      taken: places.filter(function (p) { return p.name || p.proc; }).length
    };
  }));
}

/** Таңертеңнен кешке дейін ретімен (бірдей уақытта — таблицадағы ретімен). */
function sortByTime_(list) {
  return list
    .map(function (x, i) { return { x: x, i: i }; })
    .sort(function (a, b) { return (a.x.minutes - b.x.minutes) || (a.i - b.i); })
    .map(function (w) { return w.x; });
}

/** Жолдың ағымдағы мәндері — қақтығысты анықтау үшін клиентке беріледі. */
function rowSnapshot(values, row, kind) {
  var cols = kind === 'doctor' ? LAYOUT.doctor : LAYOUT.physio;
  var fields = kind === 'doctor' ? LAYOUT.doctorFields : LAYOUT.physioFields;
  return fields.map(function (f) { return cell_(values, row, cols[f]); }).join('␟');
}

/** Бүкіл парақты талдау. */
function parseDay(values, merges) {
  var headerRow = findHeaderRow(values);
  return {
    headerRow: headerRow,
    doctor: parseDoctorSlots(values, headerRow),
    physio: parsePhysioBlocks(values, headerRow, merges)
  };
}

/** Пациентті іздеу сұранысына сәйкестік. */
function matchesQuery(query, name, phoneDigits) {
  var q = String(query || '').trim().toLowerCase();
  if (!q) return false;
  var qDigits = q.replace(/\D/g, '');
  if (qDigits.length >= 4 && qDigits.length === q.replace(/[\s+()-]/g, '').length) {
    // Сұраныс тек цифрлардан тұрады — телефон бойынша іздейміз (8/7 айырмасынсыз).
    // "8701…" және "+7701…" бірдей: базада нөмір 7-ден басталады.
    var variants = [qDigits];
    if (qDigits[0] === '8') variants.push('7' + qDigits.slice(1));
    return Boolean(phoneDigits) && variants.some(function (v) { return phoneDigits.indexOf(v) !== -1; });
  }
  return String(name || '').toLowerCase().indexOf(q) !== -1;
}

/** Бір күннің деректерінен статистика жинақтайды (acc біртіндеп толады). */
function accumulateStats(acc, iso, day) {
  var booked = day.doctor.filter(function (s) { return s.booked; });
  var physioCount = 0;
  day.physio.forEach(function (b) {
    b.places.forEach(function (p) {
      if (!p.name) return;
      physioCount++;
      var proc = p.proc || 'көрсетілмеген';
      acc.byProc[proc] = (acc.byProc[proc] || 0) + 1;
    });
  });
  booked.forEach(function (s) {
    acc.bySource[s.source || '—'] = (acc.bySource[s.source || '—'] || 0) + 1;
    acc.byRecorder[s.recorder || '—'] = (acc.byRecorder[s.recorder || '—'] || 0) + 1;
    acc.byService[s.service || '—'] = (acc.byService[s.service || '—'] || 0) + 1;
    if (s.attended === '✅') acc.came++;
    else if (s.attended === '❌') acc.missed++;
    else acc.unmarked++;
  });
  acc.total += booked.length;
  acc.physio += physioCount;
  acc.days.push({ date: iso, doctor: booked.length, physio: physioCount, slots: day.doctor.length });
  return acc;
}

function emptyStats() {
  return {
    total: 0, physio: 0, came: 0, missed: 0, unmarked: 0,
    bySource: {}, byRecorder: {}, byService: {}, byProc: {}, days: []
  };
}

// ════════ Dates.gs ════════
/**
 * Күн, уақыт және телефон нөмірімен жұмыс істейтін таза функциялар.
 * Apps Script API-ін қолданбайды, сондықтан Node-та тестіленеді.
 */

// "5.11.2026", "16.11.2026", "18.11.26", қате жазылған "10.112026" — бәрі танылады.
// "5.11.2026 (копия)", "Лист5" сияқты парақтар күн емес.
var DATE_SHEET_RE = /^\s*(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})\s*$/;

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Парақ атауын ISO күнге айналдырады ("2026-11-16") немесе null қайтарады. */
function parseSheetName(name) {
  var m = DATE_SHEET_RE.exec(String(name == null ? '' : name));
  if (!m) return null;
  var d = Number(m[1]);
  var mo = Number(m[2]);
  var y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1) return null;
  var check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return y + '-' + pad2_(mo) + '-' + pad2_(d);
}

/** ISO күннен жаңа парақ атауын жасайды: "2026-11-19" → "19.11.2026". */
function formatSheetName(iso) {
  var p = splitIso_(iso);
  return p.d + '.' + pad2_(p.m) + '.' + p.y;
}

function splitIso_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) throw new Error('Күн форматы қате: ' + iso);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** ISO күнге n күн қосады. */
function addDays(iso, n) {
  var p = splitIso_(iso);
  var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return dt.getUTCFullYear() + '-' + pad2_(dt.getUTCMonth() + 1) + '-' + pad2_(dt.getUTCDate());
}

/** "9:00" → 540, "19" → 1140, "9.30" → 570. Уақыт емес болса null. */
function parseTime(s) {
  var m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  var h = Number(m[1]);
  var min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 540 → "09:00" */
function formatMinutes(total) {
  return pad2_(Math.floor(total / 60)) + ':' + pad2_(total % 60);
}

/**
 * Телефонды қалыпқа келтіреді. Таблицада нөмірлер "‪+7 747 685 7481‬" сияқты
 * көрінбейтін бағыт таңбаларымен келеді — олар алынып тасталады.
 * Нәтиже: { display: "+7 747 685 74 81", digits: "77476857481" }.
 * Қазақстан нөміріне ұқсамаса, мәтін тек тазаланып қайтарылады.
 */
function normalizePhone(raw) {
  var cleaned = String(raw == null ? '' : raw)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .trim();
  var digits = cleaned.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    digits = '7' + digits.slice(1);
  } else if (digits.length === 10 && digits[0] === '7') {
    digits = '7' + digits;
  } else {
    return { display: cleaned, digits: digits };
  }
  var display = '+7 ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + ' ' +
    digits.slice(7, 9) + ' ' + digits.slice(9, 11);
  return { display: display, digits: digits };
}
