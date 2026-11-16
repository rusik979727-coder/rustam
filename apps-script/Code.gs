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
  // Соңғы толтырылған жолдан кейін тағы бірнеше жол оқимыз: соңғы ем уақыты (мысалы 19:30)
  // 3 жолға біріктірілген, ал оның төменгі жолдары бос болса, getLastRow() оларды санамайды.
  var lastRow = Math.min(sh.getMaxRows(),
    Math.max(sh.getLastRow(), LAYOUT.defaultHeaderRow + 1) + LAYOUT.physioBlockSize - 1);
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

/**
 * Ем орнына жазу: аты, ем түрі, курс неше күн, нешінші күн (K–N).
 * data.name мен data.proc бос болса — орын толық босатылады.
 */
function savePhysio(sheetName, row, data, prev) {
  return withLock_(function () {
    var sh = sheet_(sheetName);
    assertPhysioRow_(sh, row);
    assertUnchanged_(sh, row, 'physio', prev);
    var name = cleanText_(data && data.name, 120);
    var proc = cleanText_(data && data.proc, 120);
    var range = sh.getRange(row, LAYOUT.physio.name, 1, LAYOUT.physioFields.length);
    if (!name && !proc) {
      range.clearContent();
    } else {
      var course = parseCourse(data && data.total, data && data.day);
      range.setValues([[safeCell_(name), safeCell_(proc), course.total, course.day]]);
    }
    return getDay(sheetName);
  });
}

/**
 * Пациенттің осы күнге дейінгі соңғы ем жазбасы — келесі күнді ұсыну үшін.
 * Аты бойынша (кіші-үлкен әріп пен артық бос орынға қарамай) соңғы 60 күн парағынан іздейді.
 * Қайтарады: { date, sheet, time, proc, total, day } немесе null.
 */
function lastTreatment(name, beforeIso) {
  var key = normalizeName(name);
  if (key.length < 2) return null;
  var days = dateSheets_().filter(function (d) { return d.date < beforeIso; }).reverse().slice(0, 60);
  for (var i = 0; i < days.length; i++) {
    var data = readSheet_(sheet_(days[i].sheet));
    var day = parseDay(data.values, data.merges);
    for (var b = day.physio.length - 1; b >= 0; b--) {
      var block = day.physio[b];
      for (var p = 0; p < block.places.length; p++) {
        var place = block.places[p];
        if (normalizeName(place.name) === key) {
          return { date: days[i].date, sheet: days[i].sheet, time: block.time,
            proc: place.proc, total: place.total, day: place.day };
        }
      }
    }
  }
  return null;
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
      sh.getRange(day.headerRow + 1, LAYOUT.physio.name, last - day.headerRow, LAYOUT.physioFields.length).clearContent();
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
            name: p.name, service: p.proc, total: p.total, day: p.day });
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
