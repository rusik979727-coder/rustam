/**
 * @OnlyCurrentDoc  (скрипт тек осы таблицаға ғана қол жеткізеді)
 *
 * Белес График — Google таблицамен тікелей жұмыс істейтін веб-приложение.
 * Бұл скрипт таблицаның өзіне байланады (Кеңейтімдер → Apps Script).
 * Клиент функцияларды google.script.run арқылы шақырады.
 * Атауы "_" белгісімен аяқталатын функциялар клиентке ашық емес.
 *
 * ЖЫЛДАМДЫҚ ТУРАЛЫ
 * Таблицаға әр сұраныс (getRange…getValues, getDataValidation т.б.) 0,1–1 секунд алады.
 * Сондықтан:
 *  1. Әр күн парағының талданған нұсқасы CacheService-те сақталады (кэш).
 *     Іздеу, есеп, «соңғы ем» енді әр парақты қайта оқымайды — кэштен бір сұраныспен алады.
 *  2. Жазу кезінде парақ бір-ақ рет оқылады; жазғаннан кейін тек өзгерген жол қайта оқылады.
 *  3. Таблицаны қолмен өзгерткенде onEdit сол парақтың кэшін өшіреді — қолданба жаңа деректі көреді.
 *  4. Dropdown тізімдері 4 бөлек сұраныспен емес, бір сұраныспен оқылады.
 */

var CONFIG = {
  appTitle: 'Белес График',
  // Жаңа күн осы атаулы парақтан көшіріледі. Ондай парақ болмаса — соңғы күннен.
  templateSheetName: 'Шаблон',
  lockTimeoutMs: 15000,
  // Кэш қанша уақыт сақталады (секунд). Қолмен өзгерістерді onEdit бірден өшіреді,
  // бұл мерзім тек жол қосу/өшіру, dropdown өзгерту сияқты сирек жағдайларға арналған.
  cacheTtlSec: 6 * 60 * 60,
  cachePrefix: 'day:v2:'
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

/**
 * Таблицаны қолмен өзгерткенде автоматты іске қосылады (қарапайым триггер, баптау керек емес).
 * Өзгерген парақтың кэшін өшіреді, сонда қолданба келесі жолы жаңа деректі оқиды.
 */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : null;
    if (name) cacheDrop_(name);
  } catch (err) {
    // кэш маңызды емес — қате болса, елемейміз
  }
}

/**
 * Кэшті толық тазалау. Таблицада жол қосып/өшіріп, dropdown немесе біріктірулерді
 * өзгерткен соң Apps Script редакторынан бір рет іске қосыңыз (▶ Выполнить → clearCache).
 */
function clearCache() {
  var names = ss_().getSheets().map(function (sh) { return sh.getName(); });
  try { cache_().removeAll(names.map(cacheKey_)); } catch (e) { /* елемейміз */ }
  return names.length;
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

/** Парақты оқып, бірден талдайды: { values, merges, day }. */
function readDayData_(sh) {
  var data = readSheet_(sh);
  data.day = parseDay(data.values, data.merges);
  return data;
}

/** Dropdown тізімдерін таблицаның өзіндегі validation-нан оқиды (бір сұраныспен). */
function readOptions_(sh, row) {
  var C = LAYOUT.doctor;
  var fields = ['recorder', 'source', 'service', 'attended'];
  var cols = fields.map(function (f) { return C[f]; });
  var first = Math.min.apply(null, cols);
  var last = Math.max.apply(null, cols);
  var rules = [];
  try {
    rules = sh.getRange(row, first, 1, last - first + 1).getDataValidations()[0] || [];
  } catch (e) {
    rules = [];
  }
  var out = {};
  fields.forEach(function (field) {
    var list = null;
    try {
      var rule = rules[C[field] - first];
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

/** Таблица "+7…" немесе "=…" мәтінін формула деп қабылдамауы үшін алдына апостроф қояды. */
function safeCell_(v) {
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

/** Клиент ашқан жол сол күйінде ме? Парақ бір рет оқылған values бойынша тексереді. */
function assertUnchanged_(values, row, kind, prev) {
  if (prev == null) return;
  if (rowSnapshot(values, row, kind) !== prev) {
    throw new Error('CONFLICT: Бұл жолды сіз ашқаннан кейін басқа адам өзгертті. Кесте жаңартылды — қайта тексеріңіз.');
  }
}

function assertDoctorRow_(data, row) {
  var ok = data.day.doctor.some(function (s) { return s.row === row; });
  if (!ok) throw new Error('Бұл жолда дәрігер уақыты жоқ (жол ' + row + ').');
}

function assertPhysioRow_(data, row) {
  var ok = data.day.physio.some(function (b) {
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

function doctorRowValues_(options, input) {
  var clean = {
    name: cleanText_(input.name, 120),
    phone: input.phone ? normalizePhone(input.phone).display : '',
    comment: cleanText_(input.comment, 300),
    recorder: cleanText_(input.recorder),
    source: cleanText_(input.source),
    service: cleanText_(input.service),
    attended: cleanText_(input.attended)
  };
  if (!clean.name && !clean.phone) throw new Error('Пациенттің атын немесе телефонын енгізіңіз.');
  if (!clean.recorder) throw new Error('Қай менеджер жазғанын таңдаңыз.');
  checkOption_(options, 'recorder', clean.recorder, 'Жазған');
  checkOption_(options, 'source', clean.source, 'Қайдан келді');
  checkOption_(options, 'service', clean.service, 'Қызмет');
  checkOption_(options, 'attended', clean.attended, 'Келді ме');
  return LAYOUT.doctorFields.map(function (f) { return safeCell_(clean[f]); });
}

// ───────────────────────── Кэш ─────────────────────────

function cache_() {
  return CacheService.getScriptCache();
}

function cacheKey_(sheetName) {
  return CONFIG.cachePrefix + sheetName;
}

/** Бірнеше күнді кэштен бір сұраныспен алады: { парақ атауы: payload }. */
function cacheGetMany_(names) {
  var out = {};
  for (var i = 0; i < names.length; i += 100) {
    var chunk = names.slice(i, i + 100);
    var keys = chunk.map(cacheKey_);
    var got = {};
    try { got = cache_().getAll(keys) || {}; } catch (e) { got = {}; }
    chunk.forEach(function (n, j) {
      var raw = got[keys[j]];
      if (!raw) return;
      try { out[n] = JSON.parse(raw); } catch (e) { /* бүлінген жазба — елемейміз */ }
    });
  }
  return out;
}

function cachePutMany_(map) {
  var names = Object.keys(map);
  if (!names.length) return;
  var batch = {};
  names.forEach(function (n) { batch[cacheKey_(n)] = JSON.stringify(map[n]); });
  try {
    cache_().putAll(batch, CONFIG.cacheTtlSec);
  } catch (e) {
    // Біреуі тым үлкен болса, putAll құлайды — онда бір-бірлеп сақтаймыз.
    names.forEach(function (n) {
      try { cache_().put(cacheKey_(n), batch[cacheKey_(n)], CONFIG.cacheTtlSec); } catch (err) { cacheDrop_(n); }
    });
  }
}

function cachePut_(name, payload) {
  var map = {};
  map[name] = payload;
  cachePutMany_(map);
}

function cacheDrop_(name) {
  try { cache_().remove(cacheKey_(name)); } catch (e) { /* елемейміз */ }
}

/** Клиентке берілетін бір күннің деректері (getDay жауабы, loadedAt-сыз). */
function buildPayload_(sheetName, sh, data, options) {
  var day = data.day;
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
    options: options || readOptions_(sh, firstSlotRow),
    procedures: procList
  };
}

function stamp_(payload) {
  var out = {};
  Object.keys(payload).forEach(function (k) { out[k] = payload[k]; });
  out.loadedAt = new Date().toISOString();
  return out;
}

/** Парақтан оқып, кэшке салады. */
function loadFresh_(sheetName) {
  var sh = sheet_(sheetName);
  var payload = buildPayload_(sheetName, sh, readDayData_(sh));
  cachePut_(sheetName, payload);
  return payload;
}

/** Бірнеше күн: алдымен кэштен, жоғын ғана парақтан оқиды. */
function loadDays_(names) {
  var got = cacheGetMany_(names);
  var fresh = {};
  names.forEach(function (n) {
    if (got[n]) return;
    var sh = ss_().getSheetByName(n);
    if (!sh) return;
    got[n] = buildPayload_(n, sh, readDayData_(sh));
    fresh[n] = got[n];
  });
  cachePutMany_(fresh);
  return got;
}

/**
 * Жазғаннан кейін: тек өзгерген жолдарды қайта оқып (бір сұраныс), күнді қайта талдап, кэшті жаңартады.
 * Бүкіл парақты екінші рет оқымаймыз.
 */
function refreshRows_(sheetName, sh, data, rows) {
  var lo = Math.min.apply(null, rows);
  var hi = Math.max.apply(null, rows);
  var fresh = sh.getRange(lo, 1, hi - lo + 1, LAYOUT.readCols).getDisplayValues();
  for (var i = 0; i < fresh.length; i++) data.values[lo - 1 + i] = fresh[i];
  data.day = parseDay(data.values, data.merges);
  var cached = cacheGetMany_([sheetName])[sheetName];
  var payload = buildPayload_(sheetName, sh, data, cached && cached.options);
  cachePut_(sheetName, payload);
  return payload;
}

/**
 * Бір парақтағы жазу операциясының ортақ қаңқасы:
 * құлып → парақты бір рет оқу → fn тексеріп жазады және өзгерген жолдарды қайтарады →
 * сол жолдарды ғана қайта оқу → жаңа күн. Қате болса, сол парақтың кэші өшіріледі,
 * сонда клиент келесі жолы таблицадағы нақты күйді көреді.
 */
function mutate_(sheetName, fn) {
  return withLock_(function () {
    try {
      var sh = sheet_(sheetName);
      var data = readDayData_(sh);
      assertSameStructure_(sheetName, data);
      var rows = fn(sh, data);
      return stamp_(refreshRows_(sheetName, sh, data, rows));
    } catch (e) {
      cacheDrop_(sheetName);
      throw e;
    }
  });
}

/** Кестенің «қаңқасы»: қай жолда қай уақыт тұр. Жол қосылса/өшірілсе, бұл өзгереді. */
function structureSig_(day) {
  return day.doctor.map(function (s) { return s.row + '=' + s.time; }).join(',') + '|' +
    day.physio.map(function (b) { return b.startRow + '=' + b.time; }).join(',');
}

/**
 * Қауіпсіздік: кэштегі кесте мен таблицадағы нақты кестенің жолдары сәйкес пе?
 * Біреу таблицаға жол қосып/өшірсе, клиенттегі жол нөмірлері басқа уақытқа сәйкес келуі мүмкін.
 * Ондай жағдайда ештеңе жазбаймыз — кэшті тазалап, клиентке кестені жаңартуды айтамыз.
 */
function assertSameStructure_(sheetName, data) {
  var cached = cacheGetMany_([sheetName])[sheetName];
  if (cached && structureSig_(cached) !== structureSig_(data.day)) {
    cacheDrop_(sheetName);
    throw new Error('CONFLICT: Таблицада жолдар өзгерген екен. Кесте жаңартылды — қайта жазып көріңіз.');
  }
}

function a1Col_(col) {
  var s = '';
  while (col > 0) {
    var m = (col - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}

// ───────────────────────── Клиентке ашық API ─────────────────────────

/** Бастапқы деректер: күндер тізімі, бүгінгі күн және (бар болса) бүгінгі кесте — бір сұраныспен. */
function getBootstrap() {
  var today = todayIso_();
  var days = dateSheets_().map(function (d) { return { sheet: d.sheet, date: d.date }; });
  var todaySheet = days.filter(function (d) { return d.date === today; })[0];
  var todayDay = null;
  if (todaySheet) {
    try { todayDay = getDay(todaySheet.sheet); } catch (e) { todayDay = null; }
  }
  return {
    title: ss_().getName(),
    url: ss_().getUrl(),
    today: today,
    days: days,
    todayDay: todayDay
  };
}

/** Бір күннің толық кестесі. Кэште болса — бірден, болмаса парақтан оқиды. force=true — міндетті түрде парақтан. */
function getDay(sheetName, force) {
  if (!force) {
    var cached = cacheGetMany_([sheetName])[sheetName];
    if (cached) return stamp_(cached);
  }
  return stamp_(loadFresh_(sheetName));
}

/** Дәрігер слотына жазу немесе жазбаны өзгерту. */
function saveAppointment(sheetName, row, input, prev) {
  return mutate_(sheetName, function (sh, data) {
    assertDoctorRow_(data, row);
    assertUnchanged_(data.values, row, 'doctor', prev);
    var values = doctorRowValues_(readOptions_(sh, row), input);
    sh.getRange(row, LAYOUT.doctor.name, 1, values.length).setValues([values]);
    return [row];
  });
}

/** Жазбаны өшіру (тек мәндер тазаланады, dropdown пен формат қалады). */
function clearAppointment(sheetName, row, prev) {
  return mutate_(sheetName, function (sh, data) {
    assertDoctorRow_(data, row);
    assertUnchanged_(data.values, row, 'doctor', prev);
    sh.getRange(row, LAYOUT.doctor.name, 1, LAYOUT.doctorFields.length).clearContent();
    return [row];
  });
}

/** Келді (✅) / келмеді (❌) / белгісіз (''). */
function setAttendance(sheetName, row, value, prev) {
  return mutate_(sheetName, function (sh, data) {
    assertDoctorRow_(data, row);
    assertUnchanged_(data.values, row, 'doctor', prev);
    var cached = cacheGetMany_([sheetName])[sheetName];
    var options = cached ? cached.options : readOptions_(sh, row);
    checkOption_(options, 'attended', value, 'Келді ме');
    var cell = sh.getRange(row, LAYOUT.doctor.attended);
    if (value) cell.setValue(value); else cell.clearContent();
    return [row];
  });
}

/** Жазбаны басқа уақытқа (басқа күнге де) көшіру. Мақсатты слот бос болуы керек. */
function moveAppointment(fromSheet, fromRow, toSheet, toRow, prev) {
  return withLock_(function () {
    try {
      var same = fromSheet === toSheet;
      var src = sheet_(fromSheet);
      var srcData = readDayData_(src);
      var dst = same ? src : sheet_(toSheet);
      var dstData = same ? srcData : readDayData_(dst);
      assertSameStructure_(fromSheet, srcData);
      if (!same) assertSameStructure_(toSheet, dstData);
      assertDoctorRow_(srcData, fromRow);
      assertDoctorRow_(dstData, toRow);
      if (same && fromRow === toRow) return stamp_(buildPayload_(fromSheet, src, srcData));
      assertUnchanged_(srcData.values, fromRow, 'doctor', prev);
      var target = rowSnapshot(dstData.values, toRow, 'doctor').split('␟');
      if (target[0] || target[1]) {
        throw new Error('CONFLICT: Таңдалған уақыт бос емес. Басқа уақытты таңдаңыз.');
      }
      var n = LAYOUT.doctorFields.length;
      var values = src.getRange(fromRow, LAYOUT.doctor.name, 1, n).getValues().map(function (r) {
        return r.map(function (v) { return typeof v === 'string' ? safeCell_(v) : v; });
      });
      dst.getRange(toRow, LAYOUT.doctor.name, 1, n).setValues(values);
      src.getRange(fromRow, LAYOUT.doctor.name, 1, n).clearContent();
      if (same) return stamp_(refreshRows_(fromSheet, src, srcData, [fromRow, toRow]));
      refreshRows_(toSheet, dst, dstData, [toRow]);
      return stamp_(refreshRows_(fromSheet, src, srcData, [fromRow]));
    } catch (e) {
      cacheDrop_(fromSheet);
      cacheDrop_(toSheet);
      throw e;
    }
  });
}

/**
 * Ем орнына жазу: аты, ем түрі, курс неше күн, нешінші күн (K–N).
 * input.name мен input.proc бос болса — орын толық босатылады.
 */
function savePhysio(sheetName, row, input, prev) {
  return mutate_(sheetName, function (sh, data) {
    assertPhysioRow_(data, row);
    assertUnchanged_(data.values, row, 'physio', prev);
    var name = cleanText_(input && input.name, 120);
    var proc = cleanText_(input && input.proc, 120);
    var range = sh.getRange(row, LAYOUT.physio.name, 1, LAYOUT.physioFields.length);
    if (!name && !proc) {
      range.clearContent();
    } else {
      var course = parseCourse(input && input.total, input && input.day);
      range.setValues([[safeCell_(name), safeCell_(proc), course.total, course.day]]);
    }
    return [row];
  });
}

/**
 * Пациенттің осы күнге дейінгі соңғы ем жазбасы — келесі күнді ұсыну үшін.
 * Аты бойынша (кіші-үлкен әріп пен артық бос орынға қарамай) соңғы 60 күн парағынан іздейді.
 * Күндер 10-нан топтап, кэштен алынады; табылған бойда тоқтайды.
 * Қайтарады: { date, sheet, time, proc, total, day } немесе null.
 */
function lastTreatment(name, beforeIso) {
  var key = normalizeName(name);
  if (key.length < 2) return null;
  var days = dateSheets_().filter(function (d) { return d.date < beforeIso; }).reverse().slice(0, 60);
  for (var start = 0; start < days.length; start += 10) {
    var group = days.slice(start, start + 10);
    var loaded = loadDays_(group.map(function (d) { return d.sheet; }));
    for (var i = 0; i < group.length; i++) {
      var day = loaded[group[i].sheet];
      if (!day) continue;
      for (var b = day.physio.length - 1; b >= 0; b--) {
        var block = day.physio[b];
        for (var p = 0; p < block.places.length; p++) {
          var place = block.places[p];
          if (normalizeName(place.name) === key) {
            return { date: group[i].date, sheet: group[i].sheet, time: block.time,
              proc: place.proc, total: place.total, day: place.day };
          }
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
    var days = dateSheets_();
    var existing = days.filter(function (d) { return d.date === iso; })[0];
    if (existing) return { sheet: existing.sheet, created: false };

    var ss = ss_();
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

    var data = readDayData_(sh);
    var day = data.day;
    // Әр слотты бөлек тазаламай, барлығын бір сұраныспен тазалаймыз.
    var a1 = day.doctor.map(function (s) {
      return a1Col_(LAYOUT.doctor.name) + s.row + ':' +
        a1Col_(LAYOUT.doctor.name + LAYOUT.doctorFields.length - 1) + s.row;
    });
    var last = data.values.length;
    if (last > day.headerRow) {
      a1.push(a1Col_(LAYOUT.physio.name) + (day.headerRow + 1) + ':' +
        a1Col_(LAYOUT.physio.name + LAYOUT.physioFields.length - 1) + last);
    }
    if (a1.length) sh.getRangeList(a1).clearContent();
    cacheDrop_(name);
    return { sheet: name, created: true };
  });
}

/** Пациентті барлық күндерден іздеу (аты немесе телефоны бойынша). */
function searchPatient(query) {
  var q = String(query || '').trim();
  if (q.length < 2) return [];
  var list = dateSheets_();
  var loaded = loadDays_(list.map(function (d) { return d.sheet; }));
  var results = [];
  list.forEach(function (d) {
    var day = loaded[d.sheet];
    if (!day) return;
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
  var list = dateSheets_().filter(function (d) { return d.date >= fromIso && d.date <= toIso; });
  var loaded = loadDays_(list.map(function (d) { return d.sheet; }));
  list.forEach(function (d) {
    if (loaded[d.sheet]) accumulateStats(acc, d.date, loaded[d.sheet]);
  });
  acc.from = fromIso;
  acc.to = toIso;
  return acc;
}
