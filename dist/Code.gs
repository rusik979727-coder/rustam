// Белес График — Код.gs
// Apps Script-тегі ескі кодты толық өшіріп, осы файлды түгел қойыңыз.
// Қойғаннан кейін БІР РЕТ: ▶ Выполнить → setup → рұқсат беру.

// ════════ Code.gs ════════
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
 *     Жол қосу/өшіру, біріктіру, dropdown өзгерту сияқты құрылым өзгерістерін onTableChange
 *     триггері ұстап, бүкіл кэшті тазалайды. Оны орнату үшін редакторда setup функциясын
 *     БІР РЕТ іске қосыңыз (▶ Выполнить → setup → рұқсат беру).
 *  4. Dropdown тізімдері 4 бөлек сұраныспен емес, бір сұраныспен оқылады.
 *
 * «БАПТАУЛАР» ПАРАҒЫ
 * Менеджерлер, «қайдан келді», қызметтер және ем түрлерінің тізімі бір парақта тұрады.
 * setup оны бар тізімдерден автоматты жасайды және барлық күн парақтарындағы dropdown-тарды
 * осы параққа сілтейді. Сондықтан жаңа менеджерді «Баптаулар»-ға бір рет жазсаңыз,
 * ол таблицадағы барлық dropdown-та және қолданбада бірден шығады.
 */

var CONFIG = {
  appTitle: 'Белес График',
  // Жаңа күн осы атаулы парақтан көшіріледі. Ондай парақ болмаса — соңғы күннен.
  templateSheetName: 'Шаблон',
  lockTimeoutMs: 15000,
  // Кэш қанша уақыт сақталады (секунд). Өзгерістерді onEdit пен onTableChange бірден өшіреді;
  // бұл мерзім — триггер бір нәрсені байқамай қалса да, кэш 1 сағаттан артық ескірмеуі үшін.
  cacheTtlSec: 60 * 60,
  cachePrefix: 'day:v2:',
  settingsSheetName: 'Баптаулар',
  settingsCacheKey: 'settings:v1'
};

// «Баптаулар» парағының бағандары (1-жол — тақырып, 2-жолдан бастап мәндер).
var SETTINGS_COLUMNS = [
  { field: 'recorder', title: 'Менеджер' },
  { field: 'source', title: 'Қайдан келді' },
  { field: 'service', title: 'Қызмет' },
  { field: 'procedures', title: 'Ем түрлері' }
];

function doGet() {
  var t = HtmlService.createTemplateFromFile('App');
  t.logo = logoSrc_();
  return t.evaluate()
    .setTitle(CONFIG.appTitle)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/**
 * Логотип суреті ескі «Index» файлынан алынады (сурет коды өте ұзын, сондықтан App.html-ге
 * қайта көшірмейміз). Index файлын өшірмеңіз — өшірілсе, қолданба логотипсіз ашылады.
 */
function logoSrc_() {
  try {
    var html = HtmlService.createHtmlOutputFromFile('Index').getContent();
    var m = /class="brand-mark"[^>]*?src="(data:image\/[^"]+)"/.exec(html) ||
      /src="(data:image\/[^"]+)"[^>]*?class="brand-mark"/.exec(html);
    return m ? m[1] : '';
  } catch (e) {
    return '';
  }
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
    if (name === CONFIG.settingsSheetName) clearCache(); // тізімдер өзгерді — барлық күн жаңарады
    else if (name) cacheDrop_(name);
  } catch (err) {
    // кэш маңызды емес — қате болса, елемейміз
  }
}

/**
 * БІР РЕТ іске қосыңыз: редакторда ▶ Выполнить → setup, содан кейін Google сұраған рұқсатты беріңіз.
 *  1. Құрылым өзгергенде кэшті тазалайтын onTableChange триггерін орнатады.
 *  2. «Баптаулар» парағы жоқ болса, қазіргі dropdown тізімдерінен жасайды.
 *  3. Барлық күн парақтарындағы (және «Шаблон»-дағы) dropdown-тарды «Баптаулар»-ға сілтейді.
 * Қайта іске қосу зиянсыз: екінші триггер не екінші парақ жасалмайды, бар тізімдер өзгермейді.
 */
function setup() {
  if (!SpreadsheetApp.getActiveSpreadsheet()) {
    throw new Error('Бұл жоба таблицаға байланбаған. Кодты «БЕЛЕС ГРАФИК» таблицасының ' +
      'Расширения → Apps Script мәзірінен ашылған жобаға қойыңыз.');
  }
  var log = [];
  var exists = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'onTableChange';
  });
  if (!exists) ScriptApp.newTrigger('onTableChange').forSpreadsheet(ss_()).onChange().create();
  log.push(exists ? 'Триггер бұрыннан орнатылған' : 'Триггер орнатылды');

  var settings = ensureSettingsSheet_();
  log.push(settings.created ? '«' + CONFIG.settingsSheetName + '» парағы жасалды'
    : '«' + CONFIG.settingsSheetName + '» парағы бұрыннан бар');

  var count = linkDropdowns_(settings.sheet);
  log.push(count + ' парақтағы dropdown «' + CONFIG.settingsSheetName + '»-ға қосылды');

  clearCache();
  var msg = log.join('. ');
  Logger.log(msg);
  return msg;
}

/** «Баптаулар» парағын табады, жоқ болса соңғы күннің dropdown тізімдерінен жасайды. */
function ensureSettingsSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(CONFIG.settingsSheetName);
  if (sh) return { sheet: sh, created: false };

  var opts = { recorder: DEFAULT_OPTIONS.recorder, source: DEFAULT_OPTIONS.source, service: DEFAULT_OPTIONS.service };
  var procs = TREATMENTS.slice();
  var days = dateSheets_();
  if (days.length) {
    var last = sheet_(days[days.length - 1].sheet);
    var data = readDayData_(last);
    var row = data.day.doctor.length ? data.day.doctor[0].row : data.day.headerRow + 1;
    opts = readValidationOptions_(last, row);
    data.day.physio.forEach(function (b) {
      b.places.forEach(function (p) { if (p.proc && procs.indexOf(p.proc) === -1) procs.push(p.proc); });
    });
  }
  var cols = [opts.recorder, opts.source, opts.service, procs];
  var height = Math.max.apply(null, cols.map(function (c) { return c.length; }));
  var grid = [SETTINGS_COLUMNS.map(function (c) { return c.title; })];
  for (var i = 0; i < height; i++) grid.push(cols.map(function (c) { return c[i] || ''; }));

  sh = ss.insertSheet(CONFIG.settingsSheetName, ss.getSheets().length);
  sh.getRange(1, 1, grid.length, SETTINGS_COLUMNS.length).setValues(grid);
  sh.getRange(1, 1, 1, SETTINGS_COLUMNS.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return { sheet: sh, created: true };
}

/**
 * Күн парақтарындағы «записал», «источник», «услуга» бағандарының dropdown-ын
 * «Баптаулар» парағының сәйкес бағанына сілтейді. Қайтарады: өңделген парақ саны.
 */
function linkDropdowns_(settingsSheet) {
  var ss = ss_();
  var names = dateSheets_().map(function (d) { return d.sheet; });
  if (ss.getSheetByName(CONFIG.templateSheetName)) names.push(CONFIG.templateSheetName);
  var fields = ['recorder', 'source', 'service'];
  var rules = fields.map(function (f) {
    var col = 1 + SETTINGS_COLUMNS.map(function (c) { return c.field; }).indexOf(f);
    var src = settingsSheet.getRange(2, col, Math.max(settingsSheet.getMaxRows() - 1, 1), 1);
    return SpreadsheetApp.newDataValidation().requireValueInRange(src, true).setAllowInvalid(false).build();
  });
  var count = 0;
  names.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    var slots = readDayData_(sh).day.doctor;
    if (!slots.length) return;
    var rows = slots.map(function (s) { return s.row; });
    var first = Math.min.apply(null, rows);
    var last = Math.max.apply(null, rows);
    fields.forEach(function (f, i) {
      sh.getRange(first, LAYOUT.doctor[f], last - first + 1, 1).setDataValidation(rules[i]);
    });
    count++;
  });
  return count;
}

/** «Баптаулар» парағының тізімдері (кэштен). Парақ жоқ болса — null. */
function settings_() {
  try {
    var raw = cache_().get(CONFIG.settingsCacheKey);
    if (raw) { var c = JSON.parse(raw); return c.missing ? null : c; }
  } catch (e) { /* кэш жоқ — парақтан оқимыз */ }
  var sh = ss_().getSheetByName(CONFIG.settingsSheetName);
  var st = null;
  if (sh) {
    var values = sh.getDataRange().getDisplayValues().slice(1);
    st = {};
    SETTINGS_COLUMNS.forEach(function (c, i) {
      var seen = {};
      st[c.field] = values.map(function (r) { return String(r[i] == null ? '' : r[i]).trim(); })
        .filter(function (v) { if (!v || seen[v]) return false; seen[v] = true; return true; });
    });
  }
  try { cache_().put(CONFIG.settingsCacheKey, JSON.stringify(st || { missing: true }), CONFIG.cacheTtlSec); } catch (e) { /* елемейміз */ }
  return st;
}

/**
 * Таблица құрылымы өзгергенде автоматты іске қосылады (setup орнатқан триггер).
 * Кәдімгі ұяшық өзгерісін (EDIT) onEdit өзі өңдейді, қалғанының бәрінде бүкіл кэш тазаланады.
 */
function onTableChange(e) {
  if (e && e.changeType === 'EDIT') return;
  clearCache();
}

/** Кэшті толық тазалау (setup пен onTableChange қолданады; қолмен де іске қосуға болады). */
function clearCache() {
  var names = ss_().getSheets().map(function (sh) { return sh.getName(); });
  try { cache_().removeAll(names.map(cacheKey_).concat([CONFIG.settingsCacheKey])); } catch (e) { /* елемейміз */ }
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

/**
 * Формадағы тізімдер. «Баптаулар» парағы бар болса — содан (кэштен, таблицаға сұраныссыз),
 * жоқ болса — күн парағының dropdown-ынан.
 */
function readOptions_(sh, row) {
  var st = settings_();
  if (!st) return readValidationOptions_(sh, row);
  var out = {};
  ['recorder', 'source', 'service'].forEach(function (f) {
    out[f] = st[f] && st[f].length ? st[f].slice() : DEFAULT_OPTIONS[f].slice();
  });
  out.attended = DEFAULT_OPTIONS.attended.slice();
  return out;
}

/** Dropdown тізімдерін таблицаның өзіндегі validation-нан оқиды (бір сұраныспен). */
function readValidationOptions_(sh, row) {
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
  var st = settings_();
  var procList = st && st.procedures && st.procedures.length ? st.procedures.slice() : TREATMENTS.slice();
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
  if (!rows.length) {
    var c = cacheGetMany_([sheetName])[sheetName];
    return buildPayload_(sheetName, sh, data, c && c.options);
  }
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

// ───────────────────────── Ем курстары ─────────────────────────

// Пациент осыдан ұзақ келмесе, курсын тастады деп есептейміз (ауырып қалса да үлгеретіндей).
var COURSE_LOOKBACK_DAYS = 30;

function courseKey_(name, proc) {
  return normalizeName(name) + '|' + normalizeName(proc);
}

/**
 * Курсы аяқталмаған пациенттер — кестедегі жазбалардан автоматты жиналады.
 * Әр пациент + ем түрі бойынша iso күнінен бұрынғы соңғы 30 күндегі ең соңғы жазба алынады.
 * Курс күні күнтізбемен емес, келген сайын санайды: арада күн жіберсе, келесі келгенінде курс жалғасады.
 * Курс белсенді деп саналады, егер «курс неше күн» мен «нешінші күн» толтырылған және day < total болса.
 * Қайтарады: [{ name, proc, total, day (келесі күн), time, lastDate, missed, placed }] — уақыт бойынша сұрыпталған.
 * missed — соңғы келгенінен бері неше жұмыс күні келмеді; 0 болса, соңғы жұмыс күні келген.
 * Жұмыс күні = күн парағы бар және ішінде кем дегенде бір жазба бар күн. Демалыс күндері
 * (парағы жоқ немесе бос парақ) келмеді деп саналмайды.
 * placed=true — пациент бұл күнге (sheetName) бұрыннан қойылған.
 */
function getActiveCourses(sheetName) {
  var iso = parseSheetName(sheetName);
  if (!iso) throw new Error('Күн парағы емес: ' + sheetName);
  var from = addDays(iso, -COURSE_LOOKBACK_DAYS);
  var list = dateSheets_().filter(function (d) { return d.date < iso && d.date >= from; }).reverse();
  var loaded = loadDays_(list.map(function (d) { return d.sheet; }).concat([sheetName]));

  var already = {};
  var target = loaded[sheetName];
  if (target) {
    target.physio.forEach(function (b) {
      b.places.forEach(function (p) { if (p.name) already[courseKey_(p.name, p.proc)] = true; });
    });
  }

  // Жұмыс күндері: ішінде бір де болса жазба бар парақтар.
  var workDays = list.filter(function (d) {
    var day = loaded[d.sheet];
    return day && (day.doctor.some(function (x) { return x.booked; }) ||
      day.physio.some(function (b) { return b.taken > 0; }));
  });

  var seen = {};
  var out = [];
  list.forEach(function (d) {
    var day = loaded[d.sheet];
    if (!day) return;
    day.physio.forEach(function (b) {
      b.places.forEach(function (p) {
        if (!p.name) return;
        var key = courseKey_(p.name, p.proc);
        if (seen[key]) return; // жаңарақ жазбасы бұрын қаралған
        seen[key] = true;
        var total = Number(p.total), dayNo = Number(p.day);
        if (!total || !dayNo || dayNo >= total) return; // курс белгісіз немесе аяқталған
        var missed = workDays.filter(function (x) { return x.date > d.date; }).length;
        out.push({ name: p.name, proc: p.proc, total: total, day: dayNo + 1, time: b.time,
          lastDate: d.date, missed: missed, placed: Boolean(already[key]) });
      });
    });
  });
  out.sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : a.name < b.name ? -1 : 1; });
  return out;
}

/**
 * Таңдалған курстағы пациенттерді күнге қою. Әрқайсысы өз уақытына, ол толы болса —
 * ең жақын бос орынға (тең болса, кейінгі уақытқа) қойылады. Бұрыннан қойылғандар өткізіледі.
 * items: [{ name, proc, total, day, time }].
 * Қайтарады: { day, placed: [{name, time}], skipped: [{name, reason}] }.
 */
function placeCourses(sheetName, items) {
  var placed = [];
  var skipped = [];
  var day = mutate_(sheetName, function (sh, data) {
    var blocks = data.day.physio;
    var present = {};
    blocks.forEach(function (b) {
      b.places.forEach(function (p) { if (p.name) present[courseKey_(p.name, p.proc)] = true; });
    });
    var rows = [];
    (items || []).forEach(function (it) {
      var name = cleanText_(it && it.name, 120);
      var proc = cleanText_(it && it.proc, 120);
      if (!name) return;
      var key = courseKey_(name, proc);
      if (present[key]) { skipped.push({ name: name, reason: 'бұрыннан қойылған' }); return; }
      var course;
      try { course = parseCourse(it.total, it.day); } catch (e) {
        skipped.push({ name: name, reason: e.message }); return;
      }
      var want = parseTime(it.time);
      var best = null;
      blocks.forEach(function (b) {
        var free = b.places.filter(function (p) { return !p.extra && !p.name && !p.proc; })[0];
        if (!free) return;
        var dist = want === null ? 0 : Math.abs(b.minutes - want);
        var later = want === null || b.minutes >= want;
        if (!best || dist < best.dist || (dist === best.dist && later && !best.later)) {
          best = { place: free, block: b, dist: dist, later: later };
        }
      });
      if (!best) { skipped.push({ name: name, reason: 'бос орын жоқ' }); return; }
      sh.getRange(best.place.row, LAYOUT.physio.name, 1, LAYOUT.physioFields.length)
        .setValues([[safeCell_(name), safeCell_(proc), course.total, course.day]]);
      best.place.name = name; // осы айналымда орын бос емес деп белгілейміз
      best.place.proc = proc;
      present[key] = true;
      rows.push(best.place.row);
      placed.push({ name: name, time: best.block.time });
    });
    return rows;
  });
  return { day: day, placed: placed, skipped: skipped };
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

// ════════ Sheet.gs ════════
/**
 * Күн парағының құрылымын оқитын таза функциялар.
 *
 * Парақ құрылымы (нақты таблицадан):
 *   2-жол — тақырып: | (уақыт) | ФИ пациента | номер | коммент | записал | источник | услуга | пд |
 *   A бағаны — дәрігер қабылдауының 20 минуттық слоттары (9:00 … 18:30, 19).
 *   J бағаны — физио уақыты (8:30 … 19:30), әр уақыт 3 жолға біріктірілген → 3 орын.
 *   K — емге жазылған адамның аты, L — ем түрі,
 *   M — курс неше күн, N — бүгін нешінші күн (мысалы 10 және 3 → «3/10»).
 */

var LAYOUT = {
  headerMarker: 'ФИ пациента',
  defaultHeaderRow: 2,
  doctor: { time: 1, name: 2, phone: 3, comment: 4, recorder: 5, source: 6, service: 7, attended: 8 },
  doctorFields: ['name', 'phone', 'comment', 'recorder', 'source', 'service', 'attended'],
  physio: { time: 10, name: 11, proc: 12, total: 13, day: 14 },
  physioFields: ['name', 'proc', 'total', 'day'],
  physioBlockSize: 3,
  readCols: 14
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
      var total = cell_(values, r, C.total);
      var dayNo = cell_(values, r, C.day);
      var inBlock = r <= end;
      if (!inBlock && !name && !proc) continue;
      places.push({ row: r, name: name, proc: proc, total: total, day: dayNo, extra: !inBlock,
        prev: rowSnapshot(values, r, 'physio') });
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

/** Аттарды салыстыру үшін: кіші әріп, артық бос орынсыз ("Жумахан  Ага " → "жумахан ага"). */
function normalizeName(name) {
  return String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

/**
 * Курс күндерін тексеру: екеуі де бос болуы мүмкін, болмаса 1–99 аралығындағы бүтін сан,
 * және «нешінші күн» курс ұзақтығынан аспайды. Қате болса, түсінікті хабармен Error лақтырады.
 */
function parseCourse(total, day) {
  function num(v, label) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (!/^\d{1,2}$/.test(s) || Number(s) < 1) throw new Error('«' + label + '» өрісіне 1-ден 99-ға дейінгі сан жазыңыз.');
    return Number(s);
  }
  var t = num(total, 'Курс неше күн');
  var d = num(day, 'Нешінші күн');
  if (t !== '' && d !== '' && d > t) throw new Error('Нешінші күн (' + d + ') курс ұзақтығынан (' + t + ') аспауы керек.');
  return { total: t, day: d };
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
 * Телефонды қалыпқа келтіреді. Таблицада нөмірлер "+7 747 685 7481" сияқты
 * көрінбейтін бағыт таңбаларымен келеді — олар алынып тасталады.
 * Нәтиже: { display: "+7 747 685 74 81", digits: "77476857481" }.
 * Қазақстан нөміріне ұқсамаса, мәтін тек тазаланып қайтарылады.
 */
function normalizePhone(raw) {
  var cleaned = String(raw == null ? '' : raw)
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
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

