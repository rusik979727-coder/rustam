/**
 * ПАЦИЕНТ КАРТАЛАРЫ
 *
 * «Пациенттер» парағында әр пациенттің бір рет толтырылатын картасы тұрады:
 * аты-жөні, телефоны, емнің басталуы мен аяқталуы, курс неше күн, күн сайынғы ем жоспары
 * (мысалы «Физио, Физио, Плазма, …»), жауапты медбике мен дәрігер.
 *
 * Емге жазғанда пациент тізімнен таңдалады: қолданба оның осы курста неше рет келгенін
 * күн парақтарынан санап, келесі күннің нөмірі мен жоспар бойынша емін өзі толтырады.
 * Келу саналатын жазба — K бағанындағы аты картадағы атпен сәйкес (кіші-үлкен әріпке қарамай),
 * күні карта басталған күннен кем емес.
 */

var PATIENT_COLUMNS = [
  { field: 'id', title: 'ID' },
  { field: 'name', title: 'Аты-жөні' },
  { field: 'phone', title: 'Телефон' },
  { field: 'start', title: 'Басталуы' },
  { field: 'end', title: 'Аяқталуы' },
  { field: 'total', title: 'Курс (күн)' },
  { field: 'plan', title: 'Ем жоспары (күн сайын)' },
  { field: 'nurse', title: 'Медбике' },
  { field: 'doctor', title: 'Дәрігер' },
  { field: 'note', title: 'Ескерту' }
];

/** Картадағы күн: "18.11.2026", "18.11.26" немесе "2026-11-18" → "2026-11-18"; бос болса ''. */
function parseCardDate_(s) {
  var v = String(s == null ? '' : s).trim();
  if (!v) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return parseSheetName(v) || '';
}

function splitPlan_(s) {
  return String(s == null ? '' : s).split(/[,;\n]/)
    .map(function (x) { return x.trim(); })
    .filter(function (x) { return x; });
}

function headerIndex_(header, columns) {
  var idx = {};
  columns.forEach(function (c, i) {
    var j = header.indexOf(c.title);
    idx[c.field] = j === -1 ? i : j;
  });
  return idx;
}

/** Барлық карталар (кэштен). fresh=true — міндетті түрде парақтан. */
function readPatients_(fresh) {
  if (!fresh) {
    try {
      var raw = cache_().get(CONFIG.patientsCacheKey);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* парақтан оқимыз */ }
  }
  var sh = ss_().getSheetByName(CONFIG.patientsSheetName);
  var list = [];
  if (sh) {
    var values = sh.getDataRange().getDisplayValues();
    var header = (values[0] || []).map(function (h) { return String(h).trim(); });
    var ix = headerIndex_(header, PATIENT_COLUMNS);
    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var get = function (f) { var v = row[ix[f]]; return v == null ? '' : String(v).trim(); };
      if (!get('name')) continue;
      list.push({
        row: r + 1,
        id: get('id') || ('row' + (r + 1)),
        name: get('name'),
        phone: get('phone'),
        start: parseCardDate_(get('start')),
        end: parseCardDate_(get('end')),
        total: Number(get('total')) || 0,
        plan: splitPlan_(get('plan')),
        nurse: get('nurse'),
        doctor: get('doctor'),
        note: get('note')
      });
    }
  }
  try { cache_().put(CONFIG.patientsCacheKey, JSON.stringify(list), CONFIG.cacheTtlSec); } catch (e) { /* елемейміз */ }
  return list;
}

function ensurePatientsSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(CONFIG.patientsSheetName);
  if (sh) return sh;
  sh = ss.insertSheet(CONFIG.patientsSheetName, ss.getSheets().length);
  sh.getRange(1, 1, 1, PATIENT_COLUMNS.length)
    .setValues([PATIENT_COLUMNS.map(function (c) { return c.title; })]);
  sh.getRange(1, 1, 1, PATIENT_COLUMNS.length).setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

/**
 * Карталардың келулері: { cardId: [{ date, sheet, time, proc, row }] } — күні бойынша өсу ретімен.
 * beforeIso берілсе, тек сол күнге дейінгі келулер саналады.
 */
function patientVisits_(cards, beforeIso) {
  var out = {};
  var byName = {};
  var minStart = null;
  cards.forEach(function (c) {
    out[c.id] = [];
    var key = normalizeName(c.name);
    (byName[key] = byName[key] || []).push(c);
    var s = c.start || '0000-00-00';
    if (minStart === null || s < minStart) minStart = s;
  });
  if (!cards.length) return out;
  var list = dateSheets_().filter(function (d) {
    return d.date >= minStart && (!beforeIso || d.date < beforeIso);
  });
  var loaded = loadDays_(list.map(function (d) { return d.sheet; }));
  list.forEach(function (d) {
    var day = loaded[d.sheet];
    if (!day) return;
    day.physio.forEach(function (b) {
      b.places.forEach(function (p) {
        if (!p.name) return;
        (byName[normalizeName(p.name)] || []).forEach(function (c) {
          if (c.start && d.date < c.start) return;
          out[c.id].push({ date: d.date, sheet: d.sheet, time: b.time, proc: p.proc, row: p.row });
        });
      });
    });
  });
  return out;
}

/** Келесі келудің нөмірі мен жоспар бойынша емі. */
function nextForCard_(card, visits) {
  var n = visits.length;
  var proc = card.plan[n] || card.plan[card.plan.length - 1] || '';
  var last = visits[n - 1] || null;
  return {
    day: n + 1,
    proc: proc,
    finished: Boolean(card.total && n >= card.total),
    lastDate: last ? last.date : '',
    lastTime: last ? last.time : ''
  };
}

function uniq_(list) {
  var seen = {};
  return list.filter(function (v) {
    v = String(v || '').trim();
    if (!v || seen[v]) return false;
    seen[v] = true;
    return true;
  });
}

// ───────────────────────── Клиентке ашық API ─────────────────────────

/** Карталар тізімі, әрқайсысының барысымен (неше рет келді, келесі емі), және тізімдер. */
function getPatients() {
  var cards = readPatients_();
  var visits = patientVisits_(cards, null);
  var st = settings_() || {};
  var procs = st.procedures && st.procedures.length ? st.procedures.slice() : TREATMENTS.slice();
  var patients = cards.map(function (c) {
    var v = visits[c.id] || [];
    var next = nextForCard_(c, v);
    var out = {};
    Object.keys(c).forEach(function (k) { out[k] = c[k]; });
    out.visits = v.length;
    out.lastDate = next.lastDate;
    out.nextDay = next.day;
    out.nextProc = next.proc;
    out.finished = next.finished;
    return out;
  });
  return {
    patients: patients,
    nurses: uniq_((st.nurse || []).concat(cards.map(function (c) { return c.nurse; }))),
    doctors: uniq_((st.doctor || []).concat(cards.map(function (c) { return c.doctor; }))),
    procedures: procs,
    today: todayIso_()
  };
}

/** Бір пациенттің картасы және барлық келулері. */
function getPatientCard(id) {
  var card = readPatients_().filter(function (c) { return c.id === id; })[0];
  if (!card) throw new Error('Карта табылмады. Тізімді жаңартып көріңіз.');
  var visits = patientVisits_([card], null)[card.id] || [];
  return { card: card, visits: visits, next: nextForCard_(card, visits) };
}

/** Емге жазғанда: осы күнге (iso) дейінгі келулер бойынша келесі күн мен ем. */
function patientNext(id, iso) {
  var card = readPatients_().filter(function (c) { return c.id === id; })[0];
  if (!card) return null;
  var visits = patientVisits_([card], iso)[card.id] || [];
  var next = nextForCard_(card, visits);
  next.total = card.total;
  next.nurse = card.nurse;
  next.doctor = card.doctor;
  next.name = card.name;
  return next;
}

/**
 * Картаны сақтау (жаңа немесе бар). p: { id?, name, phone, start, end, total, plan[], nurse, doctor, note }.
 * Қайтарады: getPatients() нәтижесі және сақталған картаның id-і.
 */
function savePatient(p) {
  p = p || {};
  var name = cleanText_(p.name, 120);
  if (!name) throw new Error('Пациенттің аты-жөнін жазыңыз.');
  var total = String(p.total == null ? '' : p.total).trim();
  if (!/^\d{1,2}$/.test(total) || Number(total) < 1) throw new Error('«Курс неше күн» өрісіне 1-ден 99-ға дейінгі сан жазыңыз.');
  total = Number(total);
  var start = parseCardDate_(p.start);
  var end = parseCardDate_(p.end);
  if (!start) throw new Error('Емнің басталған күнін көрсетіңіз.');
  if (end && end < start) throw new Error('Аяқталатын күн басталған күннен бұрын болмауы керек.');

  var st = settings_() || {};
  var procs = st.procedures && st.procedures.length ? st.procedures : TREATMENTS;
  var plan = (p.plan || []).map(function (x) { return cleanText_(x, 60); }).filter(function (x) { return x; });
  plan = plan.slice(0, total);
  while (plan.length < total) plan.push(plan[plan.length - 1] || procs[0]);

  var id;
  withLock_(function () {
    var sh = ensurePatientsSheet_();
    var cards = readPatients_(true);
    var key = normalizeName(name);
    var dup = cards.filter(function (c) {
      return c.id !== p.id && normalizeName(c.name) === key && (!c.end || c.end >= start);
    })[0];
    if (dup) {
      throw new Error('«' + dup.name + '» атты пациенттің картасы бар. Бар картаны ашып өзгертіңіз, ' +
        'немесе атын ажырататындай жазыңыз (мысалы, тегін қосыңыз).');
    }
    var header = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), PATIENT_COLUMNS.length))
      .getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    var ix = headerIndex_(header, PATIENT_COLUMNS);
    var width = Math.max.apply(null, PATIENT_COLUMNS.map(function (c) { return ix[c.field]; })) + 1;

    var existing = p.id ? cards.filter(function (c) { return c.id === p.id; })[0] : null;
    if (p.id && !existing) throw new Error('Карта табылмады — оны біреу өшірген болуы мүмкін. Тізімді жаңартыңыз.');
    id = existing ? existing.id : 'P' + new Date().getTime().toString(36).toUpperCase();
    var row = existing ? existing.row : Math.max(sh.getLastRow(), 1) + 1;

    var current = existing ? sh.getRange(row, 1, 1, width).getValues()[0] : [];
    var values = [];
    for (var i = 0; i < width; i++) values.push(current[i] === undefined ? '' : current[i]);
    var put = function (f, v) { values[ix[f]] = v; };
    put('id', id);
    put('name', safeCell_(name));
    put('phone', p.phone ? safeCell_(normalizePhone(p.phone).display) : '');
    put('start', formatSheetName(start));
    put('end', end ? formatSheetName(end) : '');
    put('total', total);
    put('plan', plan.join(', '));
    put('nurse', safeCell_(cleanText_(p.nurse, 80)));
    put('doctor', safeCell_(cleanText_(p.doctor, 80)));
    put('note', safeCell_(cleanText_(p.note, 300)));
    sh.getRange(row, 1, 1, width).setValues([values]);
    try { cache_().remove(CONFIG.patientsCacheKey); } catch (e) { /* елемейміз */ }
  });
  var res = getPatients();
  res.savedId = id;
  return res;
}
