/**
 * Белес — өтінімдер қосымшасы (Google Apps Script веб-қосымшасы).
 * «Белес — Өтінімдер (CRM)» кестесіне байланған: деректер сол кестеге жазылады,
 * «Есеп» парағы бұрынғыдай өзі есептейді.
 *
 * Орнату: apps-script/ОРНАТУ.md
 * Маңызды: «Развернуть» кезінде «Запуск от имени: Пользователь, открывший приложение»
 * және «Доступ: Все, у кого есть аккаунт Google» таңдалады. Сонда әр адам өз
 * Google аккаунтымен кіреді және кестеге рұқсаты болмаса, ештеңе көре алмайды.
 */

const SHEET = 'Өтінімдер';
const SETTINGS = 'Баптаулар';
// «Өтінімдер» парағының бағандары (1-ден бастап)
const COL = { date: 1, name: 2, phone: 3, wa: 4, source: 5, complaint: 6, status: 7, manager: 8, next: 9, consult: 10, amount: 11, lost: 12, comment: 13 };
const NCOL = 13;
const CLOSED = ['Емге төледі', 'Отказ', 'Басылып кетті'];
const NO_ANSWER = 'Не отвечает';
const NO_ANSWER_RETRY_HOURS = 2;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Белес — Өтінімдер')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('apple-mobile-web-app-capable', 'yes');
}

/* ---------------- көмекшілер ---------------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone(); }
function sheet_() { return ss_().getSheetByName(SHEET); }

/** Күнді қосымшаға мәтін түрінде береміз (кесте уақыт белдеуінде): 2026-11-26T15:00 */
function fmt_(d) { return d instanceof Date ? Utilities.formatDate(d, tz_(), "yyyy-MM-dd'T'HH:mm") : ''; }
function parse_(s) { return s ? Utilities.parseDate(String(s), tz_(), "yyyy-MM-dd'T'HH:mm") : ''; }
function today_() {
  const z = tz_();
  return Utilities.parseDate(Utilities.formatDate(new Date(), z, 'yyyy-MM-dd'), z, 'yyyy-MM-dd');
}
function digits_(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}

/** «Баптаулар»: A — менеджерлер, B — статустар, C — дереккөздер, D — шағымдар, E — бас тарту себептері, F — менеджер email */
function settings_() {
  const v = ss_().getSheetByName(SETTINGS).getRange(2, 1, 29, 6).getValues();
  const col = (i) => v.map((r) => String(r[i]).trim()).filter(Boolean);
  const managers = [];
  v.forEach((r) => {
    const name = String(r[0]).trim();
    if (name) managers.push({ name: name, email: String(r[5]).trim().toLowerCase() });
  });
  return { managers: managers, statuses: col(1), sources: col(2), complaints: col(3), lostReasons: col(4) };
}

/** Кім кірді: кесте иесі — бас менеджер; «Баптаулар»-дағы email бойынша — менеджер. */
function me_(st) {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  let owner = '';
  try { owner = String(ss_().getOwner().getEmail() || '').toLowerCase(); } catch (e) {}
  const m = st.managers.filter((x) => x.email && x.email === email)[0];
  const isHead = !!email && email === owner;
  return { email: email, name: m ? m.name : (isHead ? 'Бас менеджер' : ''), isHead: isHead, known: isHead || !!m };
}

/** Соңғы толтырылған жол — «Аты-жөні» бағаны бойынша (WhatsApp формуласы бүкіл бағанды алып жатыр). */
function lastRow_(sh) {
  const n = sh.getMaxRows() - 1;
  const vals = sh.getRange(2, COL.name, n, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim()) return i + 2;
  return 1;
}

function rowToLead_(r, row) {
  return {
    row: row,
    date: fmt_(r[0]),
    name: String(r[1]),
    phone: String(r[2]),
    source: String(r[4]),
    complaint: String(r[5]),
    status: String(r[6]),
    manager: String(r[7]),
    next: fmt_(r[8]),
    consult: fmt_(r[9]),
    amount: r[10] === '' ? '' : Number(r[10]),
    lost: String(r[11]),
    comment: String(r[12]),
  };
}

function readLeads_(sh) {
  const last = lastRow_(sh);
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, NCOL).getValues()
    .map((r, i) => rowToLead_(r, i + 2))
    .filter((l) => l.name.trim());
}

/* ---------------- қосымша шақыратын функциялар ---------------- */

function getData() {
  const st = settings_();
  const me = me_(st);
  const lists = {
    statuses: st.statuses, sources: st.sources, complaints: st.complaints,
    lostReasons: st.lostReasons, managers: st.managers.map((m) => m.name),
  };
  if (!me.known) return { me: me, lists: lists, leads: [], denied: true, now: fmt_(new Date()) };
  let leads = readLeads_(sheet_());
  if (!me.isHead) leads = leads.filter((l) => l.manager === me.name);
  return { me: me, lists: lists, leads: leads, now: fmt_(new Date()) };
}

/** Жаңа өтінім. Бір нөмірден ашық өтінім бар болса — жаңасы құрылмайды. */
function addLead(d) {
  const st = settings_();
  const me = me_(st);
  if (!me.known) throw new Error('Кіруге рұқсат жоқ');
  const name = String(d.name || '').trim();
  const phone = String(d.phone || '').trim();
  if (!name || !phone) throw new Error('Аты мен телефонын жазыңыз');
  const manager = me.isHead ? String(d.manager || '') : me.name;

  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const open = readLeads_(sh).filter((l) => digits_(l.phone) === digits_(phone) && CLOSED.indexOf(l.status) < 0)[0];
    if (open) return { ok: false, duplicate: open };

    const row = lastRow_(sh) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 100);
    sh.getRange(row, COL.date, 1, 3).setValues([[today_(), name, phone]]);
    sh.getRange(row, COL.source, 1, NCOL - COL.source + 1).setValues([[
      d.source || '', d.complaint || '', st.statuses[0] || 'Лид', manager, '', '', '', '', String(d.comment || '').trim(),
    ]]);
    SpreadsheetApp.flush();
    return { ok: true, lead: rowToLead_(sh.getRange(row, 1, 1, NCOL).getValues()[0], row) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Өтінімді жаңарту. check — қосымшадағы аты мен телефоны: кесте сұрыпталып,
 * жол ауысып кетсе, басқа адамның жолы өзгеріп кетпеуі үшін тексереміз.
 * patch: status, next, consult, amount, lost, note, manager (тек бас менеджер)
 */
function updateLead(row, check, patch) {
  const st = settings_();
  const me = me_(st);
  if (!me.known) throw new Error('Кіруге рұқсат жоқ');
  const lock = LockService.getDocumentLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const cur = rowToLead_(sh.getRange(row, 1, 1, NCOL).getValues()[0], row);
    if (cur.name !== check.name || cur.phone !== check.phone) {
      throw new Error('Кесте өзгерген. «Жаңарту» батырмасын басып, қайталаңыз.');
    }
    if (!me.isHead && cur.manager !== me.name) throw new Error('Бұл өтінім сізге тиесілі емес');

    if (patch.status !== undefined) {
      if (st.statuses.indexOf(patch.status) < 0) throw new Error('Белгісіз статус');
      sh.getRange(row, COL.status).setValue(patch.status);
      // «Не отвечает» → 2 сағаттан кейін қайта қоңырау (уақыт қойылмаған не өтіп кеткен болса)
      if (patch.status === NO_ANSWER && patch.next === undefined) {
        const nextCell = sh.getRange(row, COL.next);
        const n = nextCell.getValue();
        if (!(n instanceof Date) || n < new Date()) nextCell.setValue(new Date(Date.now() + NO_ANSWER_RETRY_HOURS * 3600000));
      }
      if (patch.status !== 'Отказ') sh.getRange(row, COL.lost).setValue('');
    }
    if (patch.next !== undefined) sh.getRange(row, COL.next).setValue(parse_(patch.next));
    if (patch.consult !== undefined) sh.getRange(row, COL.consult).setValue(parse_(patch.consult));
    if (patch.amount !== undefined) sh.getRange(row, COL.amount).setValue(patch.amount === '' ? '' : Math.max(0, Math.round(Number(patch.amount))));
    if (patch.lost !== undefined) sh.getRange(row, COL.lost).setValue(patch.lost);
    if (patch.manager !== undefined && me.isHead) sh.getRange(row, COL.manager).setValue(patch.manager);
    if (patch.note) {
      const stamp = Utilities.formatDate(new Date(), tz_(), 'dd.MM HH:mm');
      const line = stamp + ' ' + (me.name || me.email) + ': ' + String(patch.note).trim();
      sh.getRange(row, COL.comment).setValue(cur.comment ? cur.comment + '\n' + line : line);
    }
    SpreadsheetApp.flush();
    return rowToLead_(sh.getRange(row, 1, 1, NCOL).getValues()[0], row);
  } finally {
    lock.releaseLock();
  }
}
