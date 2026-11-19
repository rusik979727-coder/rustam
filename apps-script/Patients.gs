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
  { field: 'note', title: 'Ескерту' },
  { field: 'restDays', title: 'Демалыс күндері' },
  { field: 'absences', title: 'Келмейтін күндері' },
  { field: 'complaint', title: 'Шағымы' },
  { field: 'complaintDate', title: 'Шағым күні' }
];

// Апта күндері: JS getUTCDay() нөмірі → қысқа атауы (таблицада осылай жазылады).
var WEEKDAY_SHORT = ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб'];
var ABSENCE_REASONS = ['Келмейді', 'Демалыс'];

/** "Сб, Жс" → [6, 0]. Бос болса — жексенбі; "жоқ" — демалыссыз. */
function parseRestDays_(s) {
  var v = String(s == null ? '' : s).trim();
  if (!v) return [0];
  if (/^жоқ$/i.test(v)) return [];
  var out = [];
  v.split(/[,;\s]+/).forEach(function (x) {
    var i = WEEKDAY_SHORT.map(function (w) { return w.toLowerCase(); }).indexOf(x.toLowerCase().slice(0, 2));
    if (i !== -1 && out.indexOf(i) === -1) out.push(i);
  });
  return out;
}

function formatRestDays_(days) {
  if (!days.length) return 'жоқ';
  return [1, 2, 3, 4, 5, 6, 0].filter(function (d) { return days.indexOf(d) !== -1; })
    .map(function (d) { return WEEKDAY_SHORT[d]; }).join(', ');
}

/** "20.11.2026-22.11.2026 Келмейді; 25.11.2026 Демалыс" → [{from, to, reason}] */
function parseAbsences_(s) {
  return String(s == null ? '' : s).split(/[;\n]/).map(function (part) {
    var m = /^\s*([\d.]+)(?:\s*[–—-]\s*([\d.]+))?\s*(.*)$/.exec(part);
    if (!m) return null;
    var from = parseCardDate_(m[1]);
    var to = m[2] ? parseCardDate_(m[2]) : from;
    if (!from) return null;
    if (!to || to < from) to = from;
    return { from: from, to: to, reason: m[3].trim() || 'Келмейді' };
  }).filter(function (a) { return a; });
}

function formatAbsences_(list) {
  return list.map(function (a) {
    return formatSheetName(a.from) + (a.to && a.to !== a.from ? '-' + formatSheetName(a.to) : '') + ' ' + a.reason;
  }).join('; ');
}

function cleanAbsences_(list) {
  var out = [];
  (list || []).forEach(function (a) {
    var from = parseCardDate_(a && a.from);
    var to = parseCardDate_(a && a.to) || from;
    if (!from) return;
    if (to < from) { var t = to; to = from; from = t; }
    var reason = cleanText_(a.reason, 40) || 'Келмейді';
    out.push({ from: from, to: to, reason: reason });
  });
  out.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
  return out;
}

/** Пациент бұл күні келмейді ме? Себебін қайтарады ('Демалыс', 'Келмейді', …) немесе ''. */
function cardOffReason_(card, iso) {
  for (var i = 0; i < (card.absences || []).length; i++) {
    var a = card.absences[i];
    if (iso >= a.from && iso <= a.to) return a.reason;
  }
  if ((card.restDays || []).indexOf(isoWeekday_(iso)) !== -1) return 'Демалыс күні';
  return '';
}

function isoWeekday_(iso) {
  var p = splitIso_(iso);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

/** Курс қай күні бітеді: басталған күннен total жұмыс күнін санаймыз (демалыс пен келмейтін күндер есептелмейді). */
function computeEnd_(card) {
  if (!card.start || !card.total) return '';
  var iso = card.start, n = 0, guard = 0;
  while (guard++ < 400) {
    if (!cardOffReason_(card, iso)) { n++; if (n >= card.total) return iso; }
    iso = addDays(iso, 1);
  }
  return '';
}

/** Аттың дәл түрі (қайталануды тексеру үшін): кіші әріп, артық бос орынсыз, «апа/ага» сақталады. */
function strictName_(name) {
  return String(name || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

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
        note: get('note'),
        restDays: ix.restDays < row.length ? parseRestDays_(get('restDays')) : [0],
        absences: ix.absences < row.length ? parseAbsences_(get('absences')) : [],
        complaint: ix.complaint < row.length ? get('complaint') : '',
        complaintDate: ix.complaintDate < row.length ? parseCardDate_(get('complaintDate')) : ''
      });
    }
  }
  try { cache_().put(CONFIG.patientsCacheKey, JSON.stringify(list), CONFIG.cacheTtlSec); } catch (e) { /* елемейміз */ }
  return list;
}

function ensurePatientsSheet_() {
  var ss = ss_();
  var sh = ss.getSheetByName(CONFIG.patientsSheetName);
  if (sh) {
    // Ескі парақта жаңа бағандар (демалыс, келмейтін күндер) жоқ болса — соңына қосамыз.
    var width = Math.max(sh.getLastColumn(), 1);
    var header = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    var missing = PATIENT_COLUMNS.filter(function (c) { return header.indexOf(c.title) === -1; });
    if (missing.length) {
      var at = header.filter(function (h) { return h; }).length + 1;
      sh.getRange(1, at, 1, missing.length).setValues([missing.map(function (c) { return c.title; })]);
      sh.getRange(1, at, 1, missing.length).setFontWeight('bold');
    }
    return sh;
  }
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
        if (!p.name || p.absent) return; // «келмейді» деп белгіленген күн курсқа саналмайды
        (byName[normalizeName(p.name)] || []).forEach(function (c) {
          if (c.start && d.date < c.start) return;
          out[c.id].push({ date: d.date, sheet: d.sheet, time: b.time, proc: p.proc, row: p.row, day: p.day });
        });
      });
    });
  });
  return out;
}

/**
 * Курстың неше күні өтті. Кестеде «нешінші күн» (N) жазылған болса — соңғы жазылған нөмір
 * негізге алынады (медбикелердің өз нөмірлері), одан кейінгі нөмірсіз келулер қосылады.
 * Нөмір мүлде жоқ болса — келулер саны.
 */
function doneCount_(visits) {
  var lastIdx = -1, lastNum = 0;
  visits.forEach(function (v, i) {
    var s = String(v.day == null ? '' : v.day).trim();
    if (/^\d{1,2}$/.test(s) && Number(s) > 0) { lastIdx = i; lastNum = Number(s); }
  });
  return lastIdx === -1 ? visits.length : lastNum + (visits.length - 1 - lastIdx);
}

/** Келесі келудің нөмірі мен жоспар бойынша емі. */
function nextForCard_(card, visits) {
  var n = doneCount_(visits);
  var proc = card.plan[n] || card.plan[card.plan.length - 1] || '';
  var last = visits[visits.length - 1] || null;
  return {
    day: n + 1,
    done: n,
    proc: proc,
    finished: Boolean(card.total && n >= card.total),
    lastDate: last ? last.date : '',
    lastTime: last ? last.time : ''
  };
}

/**
 * Курс қай күні бітеді (болжам): соңғы келген күннен (не бүгіннен) кейін қалған күндер
 * санаймыз, пациенттің демалыс және келмейтін күндері өткізіледі.
 */
function projectEnd_(card, next, todayIso) {
  if (!card.total) return '';
  if (next.finished) return next.lastDate || card.end || '';
  var left = card.total - next.done;
  var iso = next.lastDate ? addDays(next.lastDate, 1) : card.start;
  if (!iso) return '';
  if (iso < todayIso) iso = todayIso;
  for (var guard = 0; guard < 400; guard++) {
    if (!cardOffReason_(card, iso)) { left--; if (left <= 0) return iso; }
    iso = addDays(iso, 1);
  }
  return '';
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
    out.visits = next.done;
    out.visitList = v.map(function (x) { return { date: x.date, time: x.time, proc: x.proc, day: x.day }; });
    out.projectedEnd = projectEnd_(c, next, todayIso_());
    out.lastDate = next.lastDate;
    out.nextDay = next.day;
    out.nextProc = next.proc;
    out.finished = next.finished;
    out.offToday = cardOffReason_(c, todayIso_());
    out.autoEnd = computeEnd_(c);
    return out;
  });
  return {
    patients: patients,
    nurses: uniq_((st.nurse || []).concat(cards.map(function (c) { return c.nurse; }))),
    doctors: uniq_((st.doctor || []).concat(cards.map(function (c) { return c.doctor; }))),
    procedures: procs,
    reasons: ABSENCE_REASONS,
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
  next.off = cardOffReason_(card, iso);
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
  if (!start) start = todayIso_();          // басталған күні жазылмаса — бүгін
  if (end && end < start) end = '';          // қате болса — қайта есептейміз

  var st = settings_() || {};
  var procs = st.procedures && st.procedures.length ? st.procedures : TREATMENTS;
  var restDays = (p.restDays || []).map(Number).filter(function (d) { return d >= 0 && d <= 6; });
  var absences = cleanAbsences_(p.absences);
  var plan = (p.plan || []).map(function (x) { return cleanText_(x, 60); }).filter(function (x) { return x; });
  plan = plan.slice(0, total);
  while (plan.length < total) plan.push(plan[plan.length - 1] || procs[0]);
  if (!end) end = computeEnd_({ start: start, total: total, restDays: restDays, absences: absences });

  var id;
  withLock_(function () {
    var sh = ensurePatientsSheet_();
    var cards = readPatients_(true);
    var key = normalizeName(name);
    // Қайталану тек аты ДӘЛ бірдей (әріп өлшемі мен бос орынға қарамай), курсы әлі жүріп
    // жатқан карта болғанда ғана тоқтатылады. «Роза» мен «Роза апа» — екі бөлек карта бола алады.
    var exact = strictName_(name);
    var dup = cards.filter(function (c) {
      if (c.id === p.id || strictName_(c.name) !== exact) return false;
      if (c.end && c.end < start) return false;
      var v = patientVisits_([c], null)[c.id] || [];
      return !nextForCard_(c, v).finished;
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
    put('restDays', formatRestDays_(restDays));
    put('absences', formatAbsences_(absences));
    // Шағым: мәтін бар болса — пациент ерекше назарда. Күні берілмесе, бүгінгі күн.
    var complaint = cleanText_(p.complaint, 300);
    var complaintDate = complaint ? (parseCardDate_(p.complaintDate) || todayIso_()) : '';
    put('complaint', safeCell_(complaint));
    put('complaintDate', complaintDate ? formatSheetName(complaintDate) : '');
    sh.getRange(row, 1, 1, width).setValues([values]);
    try { cache_().remove(CONFIG.patientsCacheKey); } catch (e) { /* елемейміз */ }
  });
  var res = getPatients();
  res.savedId = id;
  return res;
}

/**
 * Картаға келмейтін күн(дер) қосу — мысалы «Курстағылар» тізімінен «Келмейді» басқанда.
 * Бітетін күн бұрын автоматты есептелген болса, ол да ұзартылады.
 */
function addAbsence(id, from, to, reason) {
  var card = readPatients_(true).filter(function (c) { return c.id === id; })[0];
  if (!card) throw new Error('Карта табылмады. Тізімді жаңартып көріңіз.');
  var add = cleanAbsences_([{ from: from, to: to || from, reason: reason }]);
  if (!add.length) throw new Error('Күнін көрсетіңіз.');
  var wasAuto = !card.end || card.end === computeEnd_(card);
  var updated = {};
  Object.keys(card).forEach(function (k) { updated[k] = card[k]; });
  updated.absences = card.absences.concat(add);
  var end = wasAuto ? computeEnd_(updated) : card.end;
  return savePatient({ id: card.id, name: card.name, phone: card.phone, start: card.start, end: end,
    total: card.total, plan: card.plan, nurse: card.nurse, doctor: card.doctor, note: card.note,
    restDays: card.restDays, absences: updated.absences,
    complaint: card.complaint, complaintDate: card.complaintDate });
}

/**
 * Ем уақытында келді/келмеді белгісі (O бағаны): value — '✅', '❌' немесе '' (белгіні алу).
 *  ✅ — келді, бұл күн курсқа саналады;
 *  ❌ — келмеді: бұл күн курсқа саналмайды, картаға «Келмейді» болып жазылады, бітетін күн жылжиды;
 *  '' — белгі алынады; бұрын ❌ болса, картадағы сол күнгі белгі де алынады.
 * Қайтарады: { day, name, card: { id, end, oldEnd } | null }.
 */
function setPhysioAttendance(sheetName, row, value, prev, reason) {
  var iso = parseSheetName(sheetName);
  if (!iso) throw new Error('Күн парағы емес: ' + sheetName);
  value = value === '✅' || value === '❌' ? value : '';
  var name = '';
  var wasAbsent = false;
  var day = mutate_(sheetName, function (sh, data) {
    assertPhysioRow_(data, row);
    assertUnchanged_(data.values, row, 'physio', prev);
    name = cell_(data.values, row, LAYOUT.physio.name);
    if (!name) throw new Error('Бұл орында пациент жоқ.');
    var dayCell = cell_(data.values, row, LAYOUT.physio.day);
    wasAbsent = cell_(data.values, row, LAYOUT.physio.att) === '❌' || isAbsentMark(dayCell);
    var cell = sh.getRange(row, LAYOUT.physio.att);
    if (value) cell.setValue(value); else cell.clearContent();
    // Ескі тәсілмен N бағанына жазылған «келмейді» белгісі болса — оны да алып тастаймыз.
    if (value !== '❌' && isAbsentMark(dayCell)) sh.getRange(row, LAYOUT.physio.day).clearContent();
    return [row];
  });
  var card = cardForName_(name, iso);
  var cardInfo = null;
  if (card) {
    var oldEnd = card.end;
    if (value === '❌') {
      var already = card.absences.some(function (a) { return iso >= a.from && iso <= a.to; });
      if (!already) addAbsence(card.id, iso, iso, cleanText_(reason, 40) || 'Келмейді');
    } else if (wasAbsent) {
      removeAbsenceDay_(name, iso);
    }
    var fresh = readPatients_(true).filter(function (c) { return c.id === card.id; })[0];
    cardInfo = { id: card.id, end: fresh ? fresh.end : oldEnd, oldEnd: oldEnd };
  }
  return { day: day, name: name, card: cardInfo };
}

/** «Бүгін келмейді» батырмасы — setPhysioAttendance(…, '❌'). */
function markPhysioAbsent(sheetName, row, prev, reason) {
  return setPhysioAttendance(sheetName, row, '❌', prev, reason);
}

/** Аты бойынша сол күнге қатысты карта (бірнеше болса — ең соңғы басталғаны). */
function cardForName_(name, iso) {
  var key = normalizeName(name);
  return readPatients_(true).filter(function (c) {
    return normalizeName(c.name) === key && c.start && c.start <= iso;
  }).sort(function (a, b) { return a.start < b.start ? 1 : -1; })[0] || null;
}

/**
 * «Келмейді» деп белгіленген пациент сонда да келді: картадан сол күнгі келмейтін күнді алып тастаймыз
 * (бітетін күн бұрын автоматты есептелген болса, ол да қайта есептеледі).
 */
function removeAbsenceDay_(name, iso) {
  var card = cardForName_(name, iso);
  if (!card) return;
  var keep = [];
  var changed = false;
  card.absences.forEach(function (a) {
    if (a.from === iso && a.to === iso) { changed = true; return; }
    keep.push(a);
  });
  if (!changed) return;
  var wasAuto = !card.end || card.end === computeEnd_(card);
  var updated = {};
  Object.keys(card).forEach(function (k) { updated[k] = card[k]; });
  updated.absences = keep;
  savePatient({ id: card.id, name: card.name, phone: card.phone, start: card.start,
    end: wasAuto ? computeEnd_(updated) : card.end, total: card.total, plan: card.plan,
    nurse: card.nurse, doctor: card.doctor, note: card.note, restDays: card.restDays, absences: keep,
    complaint: card.complaint, complaintDate: card.complaintDate });
}

/**
 * Бос ем орнына картасы бар пациентті қою: курс күні мен емі сол күнге дейінгі келулерден
 * және картадағы жоспардан есептеледі. Пациент бұл күнге бұрын қойылған болса — қате.
 * Қайтарады: { day, name, dayNo, proc }.
 */
function placeCardPatient(sheetName, row, prev, cardId) {
  var iso = parseSheetName(sheetName);
  if (!iso) throw new Error('Күн парағы емес: ' + sheetName);
  var card = readPatients_().filter(function (c) { return c.id === cardId; })[0];
  if (!card) throw new Error('Карта табылмады. Тізімді жаңартып көріңіз.');
  var visits = patientVisits_([card], iso)[card.id] || [];
  var next = nextForCard_(card, visits);
  if (next.finished) throw new Error(card.name + ': курс аяқталған (' + card.total + ' күн). Жаңа курс болса, картаны өзгертіңіз.');
  var key = normalizeName(card.name);
  var day = mutate_(sheetName, function (sh, data) {
    assertPhysioRow_(data, row);
    assertUnchanged_(data.values, row, 'physio', prev);
    if (cell_(data.values, row, LAYOUT.physio.name)) {
      throw new Error('CONFLICT: Бұл орынға біреу жазылып қойыпты. Кесте жаңартылды — басқа орынды таңдаңыз.');
    }
    var already = data.day.physio.some(function (b) {
      return b.places.some(function (p) { return p.name && normalizeName(p.name) === key; });
    });
    if (already) throw new Error(card.name + ' бұл күнге бұрын қойылған.');
    sh.getRange(row, LAYOUT.physio.name, 1, LAYOUT.physio.att - LAYOUT.physio.name + 1)
      .setValues([[safeCell_(card.name), safeCell_(next.proc), card.total || '', next.day, '']]);
    return [row];
  });
  return { day: day, name: card.name, dayNo: next.day, proc: next.proc };
}

/** Картаны өшіру: «Пациенттер» парағынан сол жол өшіріледі. Кестедегі ем жазбалары өзгермейді. */
function deletePatient(id) {
  withLock_(function () {
    var sh = ss_().getSheetByName(CONFIG.patientsSheetName);
    var card = readPatients_(true).filter(function (c) { return c.id === id; })[0];
    if (!sh || !card) throw new Error('Карта табылмады — оны біреу өшірген болуы мүмкін. Тізімді жаңартыңыз.');
    sh.deleteRow(card.row);
    try { cache_().remove(CONFIG.patientsCacheKey); } catch (e) { /* елемейміз */ }
  });
  return getPatients();
}

/** «Жаңарту» батырмасы: кэшті толық тазалап, таблицадан жаңадан оқиды. */
function refreshAll() {
  clearCache();
  return getPatients();
}
