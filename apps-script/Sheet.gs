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

// «Нешінші күн» (N) бағанында сан орнына осы сөз тұрса — пациент сол күні келмеген (ауырған).
// Мұндай жазба кестеде көрініп тұрады, бірақ курс күні ретінде саналмайды.
var ABSENT_MARK = 'ауырды';
function isAbsentMark(v) {
  return /ауыр|келмеді|келмеди|❌/i.test(String(v == null ? '' : v));
}

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
        absent: Boolean(name) && isAbsentMark(dayNo),
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
      if (!p.name || p.absent) return;
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
