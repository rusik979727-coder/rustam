/**
 * Белес CRM — колл-орталыққа арналған лид базасы.
 * Бөлек Google Таблицаға байланған Apps Script қосымшасы.
 * Таблица ешкімге ашылмайды: әр менеджер өз құпия сілтемесі арқылы кіреді.
 */

const LEADS = 'Лидтер';
const SETTINGS = 'Баптаулар';
const LINKS = 'Сілтемелер';
const BOSS = 'Бастық';
const COLS = ['ID', 'Құрылды', 'Аты', 'Телефон', 'Жарнама', 'Қызмет', 'Статус', 'Менеджер', 'Келесі байланыс', 'Жазылу уақыты', 'Ескерту', 'Жаңартылды', 'Тарих'];
const F = ['id', 'created', 'name', 'phone', 'source', 'service', 'status', 'manager', 'nextCall', 'appt', 'note', 'updated', 'history'];
/** Воронка кезеңдері: [код, таблицада жазылатын атауы]. */
const STAGES = [['new', 'Новый'], ['work', 'Обработка'], ['noans', 'Не ответил'], ['booked', 'Запись'],
  ['came', 'Пришёл'], ['noshow', 'Не пришёл'], ['bought', 'Купил'], ['refused', 'Отказ']];
const STAGE_CODES = STAGES.map(function (x) { return x[0]; });
const STAGE_LABEL = {}; STAGES.forEach(function (x) { STAGE_LABEL[x[0]] = x[1]; });
const STAGE_BY_LABEL = {
  'Новый': 'new', 'Обработка': 'work', 'Не ответил': 'noans', 'Запись': 'booked', 'Пришёл': 'came', 'Пришел': 'came',
  'Не пришёл': 'noshow', 'Не пришел': 'noshow', 'Купил': 'bought', 'Отказ': 'refused',
  // ескі нұсқаның атаулары
  'Жаңа': 'new', 'Ойланып жүр': 'work', 'Жауап бермеді': 'noans', 'Жазылды': 'booked', 'Келді': 'came',
  'Келмеді': 'noshow', 'Сатып алды': 'bought', 'Бас тартты': 'refused'
};
function stageCode_(label) { return STAGE_BY_LABEL[String(label || '').trim()] || 'new'; }
const DT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/* ---------- веб-қосымша ---------- */

function doGet(e) {
  const user = userForKey_(e && e.parameter ? e.parameter.k : '');
  if (!user) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui,sans-serif;padding:32px;max-width:480px">' +
      '<h2>Сілтеме жарамсыз</h2><p>Бастықтан жаңа сілтеме сұраңыз.</p>' +
      '<p style="color:#666">Ссылка недействительна. Попросите новую ссылку у руководителя.</p></div>')
      .setTitle('Белес CRM').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.key = e.parameter.k;
  return tpl.evaluate().setTitle('Белес CRM · ' + user.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Барлық деректер: бастыққа — бәрі, менеджерге — тек өз лидтері. */
function crmData(key) {
  const u = requireUser_(key);
  const s = settings_();
  const leads = readLeads_().map(publicLead_).filter(function (l) { return u.boss || l.manager === u.name; });
  return {
    me: u.name, boss: u.boss, now: now_(),
    leads: leads,
    sources: s.sources, services: s.services, stages: STAGE_CODES,
    managers: u.boss ? s.managers : [u.name]
  };
}

/** Лидті жасау немесе өзгерту. */
function crmSave(key, input) {
  const u = requireUser_(key);
  input = input || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = leadsSheet_();
    const all = readLeads_();
    const now = now_();
    const changes = [];
    let lead;

    if (input.id) {
      lead = all.filter(function (l) { return l.id === String(input.id); })[0];
      if (!lead) throw new Error('Лид табылмады. Бетті жаңартыңыз.');
      if (!u.boss && lead.manager !== u.name) throw new Error('Бұл лид сізге бекітілмеген.');
    } else {
      const phone = normPhone_(input.phone);
      if (!phone) throw new Error('Телефон нөмірі дұрыс емес.');
      const dup = all.filter(function (l) { return l.phone === phone; })[0];
      if (dup) {
        if (u.boss || dup.manager === u.name) return { duplicate: true, lead: publicLead_(dup) };
        return { duplicate: true, other: dup.manager };
      }
      lead = { id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), created: now, status: 'Новый', manager: u.name, history: '' };
      changes.push('Лид жасалды');
    }

    const set = function (field, val, label) {
      if (val === undefined) return;
      val = val === null ? '' : String(val).trim();
      if ((lead[field] || '') === val) return;
      if (input.id) changes.push(label + ': ' + (lead[field] || '—') + ' → ' + (val || '—'));
      lead[field] = val;
    };
    if (input.phone !== undefined) {
      const p = normPhone_(input.phone);
      if (!p) throw new Error('Телефон нөмірі дұрыс емес.');
      if (p !== lead.phone && all.some(function (l) { return l.phone === p && l.id !== lead.id; })) throw new Error('Бұл нөмір басқа лидте бар.');
      set('phone', p, 'Телефон');
    }
    set('name', cut_(input.name, 100), 'Аты');
    set('source', cut_(input.source, 100), 'Жарнама');
    set('service', cut_(input.service, 100), 'Қызмет');
    if (input.status !== undefined) {
      if (STAGE_CODES.indexOf(input.status) < 0) throw new Error('Кезең дұрыс емес.');
      if (stageCode_(lead.status) !== input.status || !input.id) {
        if (input.id) changes.push('Кезең: ' + STAGE_LABEL[stageCode_(lead.status)] + ' → ' + STAGE_LABEL[input.status]);
        lead.status = STAGE_LABEL[input.status];
      }
    }
    if (input.nextCall !== undefined) { if (input.nextCall && !DT.test(input.nextCall)) throw new Error('Қоңырау уақыты дұрыс емес.'); set('nextCall', input.nextCall, 'Келесі байланыс'); }
    if (input.appt !== undefined) { if (input.appt && !DT.test(input.appt)) throw new Error('Жазылу уақыты дұрыс емес.'); set('appt', input.appt, 'Жазылу'); }
    set('note', cut_(input.note, 2000), 'Ескерту');
    if (input.manager !== undefined && u.boss) {
      if (settings_().managers.indexOf(input.manager) < 0) throw new Error('Менеджер табылмады.');
      set('manager', input.manager, 'Менеджер');
    }
    const comment = cut_(input.comment, 1000);
    if (comment) changes.push('Пікір: ' + comment);

    if (!changes.length) return { ok: true, lead: publicLead_(lead) };
    lead.updated = now;
    lead.history = addHistory_(lead.history, now + ' · ' + u.name + ' · ' + changes.join('; '));
    writeLead_(sh, lead);
    return { ok: true, lead: publicLead_(lead) };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- автоматтандыру: кіріс сілтемесі (webhook) ---------- */
/**
 * POST <қосымша сілтемесі>?token=<кілт>
 * JSON: { "phone": "+77011234567", "name": "Айгерім", "source": "Instagram", "text": "Сәлем! Акция туралы" }
 * Жаңа нөмір → жаңа лид. Бар нөмір → тарихқа «қайта жазды» деп қосылады.
 */
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  const p = e.parameter || {};
  const token = p.token || body.token;
  const hook = PropertiesService.getScriptProperties().getProperty('HOOK');
  if (!hook || token !== hook) return json_({ ok: false, error: 'token' });
  const phone = normPhone_(body.phone || body.from || p.phone);
  if (!phone) return json_({ ok: false, error: 'phone' });
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = leadsSheet_();
    const all = readLeads_();
    const now = now_();
    const text = cut_(body.text || body.message || p.text, 1000);
    const dup = all.filter(function (l) { return l.phone === phone; })[0];
    if (dup) {
      dup.updated = now;
      dup.history = addHistory_(dup.history, now + ' · WhatsApp · Қайта жазды' + (text ? ': ' + text : ''));
      writeLead_(sh, dup);
      return json_({ ok: true, id: dup.id, existing: true });
    }
    const s = settings_();
    const lead = {
      id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      created: now, name: cut_(body.name || p.name, 100), phone: phone,
      source: cut_(body.source || p.source || 'WhatsApp', 100), service: '', status: 'Новый',
      manager: nextManager_(s.managers), nextCall: '', appt: '', note: text, updated: now,
      history: now + ' · WhatsApp · Лид автоматты түрде түсті' + (text ? ': ' + text : '')
    };
    writeLead_(sh, lead);
    return json_({ ok: true, id: lead.id });
  } finally {
    lock.releaseLock();
  }
}

/* ---------- мәзір және сілтемелер (тек таблица иесі үшін) ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Белес CRM')
    .addItem('Сілтемелерді көрсету / жасау', 'createLinks')
    .addItem('Бір менеджердің сілтемесін ауыстыру', 'resetManagerLink')
    .addSeparator()
    .addItem('Автоматтандыру сілтемесін (webhook) ауыстыру', 'resetHook')
    .addToUi();
}

function createLinks() {
  setup_();
  const keys = keys_();
  settings_().managers.forEach(function (m) { if (!keys[m]) keys[m] = newKey_(); });
  saveKeys_(keys);
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('HOOK')) props.setProperty('HOOK', newKey_());
  writeLinks_();
}

function resetManagerLink() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('Сілтемені ауыстыру', 'Менеджердің атын «Баптаулар» парағындағыдай жазыңыз:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const name = r.getResponseText().trim();
  if (settings_().managers.indexOf(name) < 0) { ui.alert('Мұндай менеджер жоқ: ' + name); return; }
  const keys = keys_();
  keys[name] = newKey_();
  saveKeys_(keys);
  writeLinks_();
  ui.alert(name + ': жаңа сілтеме жасалды. Ескі сілтеме енді ашылмайды.');
}

function resetHook() {
  PropertiesService.getScriptProperties().setProperty('HOOK', newKey_());
  writeLinks_();
  notify_('Автоматтандыру сілтемесі ауыстырылды. WhatsApp сервисінде жаңасын қойыңыз.');
}

function writeLinks_() {
  const url = ScriptApp.getService().getUrl();
  if (!url) { notify_('Алдымен қосымшаны жариялаңыз: «Развернуть» → «Новое развертывание» → «Веб-приложение».'); return; }
  const ss = ss_();
  let sh = ss.getSheetByName(LINKS);
  if (!sh) sh = ss.insertSheet(LINKS);
  sh.clear();
  const keys = keys_();
  const rows = [['Кімге', 'Сілтеме', 'Ескерту']];
  settings_().managers.forEach(function (m) {
    if (!keys[m]) return;
    rows.push([m, url + '?k=' + keys[m], m === BOSS ? 'Тек өзіңізге. Барлық лидтерді көреді.' : 'Тек осы менеджерге. Өз лидтерін ғана көреді.']);
  });
  const hook = PropertiesService.getScriptProperties().getProperty('HOOK');
  if (hook) rows.push(['Автоматтандыру (webhook)', url + '?token=' + hook, 'WhatsApp сервисіне ғана беріңіз. POST сұраныс.']);
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 600); sh.setColumnWidth(3, 320);
  ss.setActiveSheet(sh);
  notify_('Сілтемелер «' + LINKS + '» парағында. Бұл парақты ешкіммен бөліспеңіз.');
}

/* ---------- көмекші функциялар ---------- */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function tz_() { return ss_().getSpreadsheetTimeZone() || Session.getScriptTimeZone(); }
function now_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm'); }
function keys_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('KEYS') || '{}'); }
function saveKeys_(k) { PropertiesService.getScriptProperties().setProperty('KEYS', JSON.stringify(k)); }
function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 24); }
function notify_(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); } }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function cut_(v, n) { return v === undefined ? undefined : String(v === null ? '' : v).trim().slice(0, n); }

function userForKey_(k) {
  if (!k) return null;
  const keys = keys_();
  const managers = settings_().managers;
  for (let i = 0; i < managers.length; i++) {
    const m = managers[i];
    if (keys[m] && keys[m] === String(k)) return { name: m, boss: m === BOSS };
  }
  return null;
}
function requireUser_(k) {
  const u = userForKey_(k);
  if (!u) throw new Error('Сілтеме жарамсыз. Бастықтан жаңа сілтеме сұраңыз.');
  return u;
}

/** Қазақстан нөмірлері: 8 701… → 7701…; 701… → 7701… */
function normPhone_(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 11 && d.charAt(0) === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d.length >= 10 && d.length <= 15 ? d : '';
}

function addHistory_(h, line) {
  const lines = (h ? String(h).split('\n') : []);
  lines.push(line);
  return lines.slice(-60).join('\n');
}

function nextManager_(managers) {
  const props = PropertiesService.getScriptProperties();
  const i = Number(props.getProperty('RR') || 0);
  props.setProperty('RR', String((i + 1) % managers.length));
  return managers[i % managers.length];
}

function setup_() {
  const ss = ss_();
  let sh = ss.getSheetByName(LEADS);
  if (!sh) {
    sh = ss.insertSheet(LEADS, 0);
    sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), COLS.length).setNumberFormat('@');
    sh.setColumnWidth(13, 400);
  }
  let st = ss.getSheetByName(SETTINGS);
  if (!st) {
    st = ss.insertSheet(SETTINGS);
    const rows = [
      ['Жарнамалар', 'Қызметтер', 'Менеджерлер'],
      ['Instagram', 'Консультация', BOSS],
      ['Facebook', '', 'Менеджер 2'],
      ['WhatsApp', '', ''],
      ['TikTok', '', ''],
      ['Таныс арқылы', '', ''],
      ['Басқа', '', '']
    ];
    st.getRange(1, 1, rows.length, 3).setValues(rows);
    st.getRange(1, 1, 1, 3).setFontWeight('bold');
    st.setFrozenRows(1);
    st.getRange('E1').setValue('Тізімдерді осы жерде өзгертіңіз. «Менеджерлер» бағанындағы әр адамға жеке сілтеме жасалады. «Бастық» деген жолды өшірмеңіз.');
  }
  // бос «Лист1» парағын жою
  const def = ss.getSheetByName('Лист1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  return sh;
}

function leadsSheet_() { return ss_().getSheetByName(LEADS) || setup_(); }

function settings_() {
  const st = ss_().getSheetByName(SETTINGS) || (setup_(), ss_().getSheetByName(SETTINGS));
  const last = Math.max(2, st.getLastRow());
  const v = st.getRange(2, 1, last - 1, 3).getDisplayValues();
  const col = function (i) { return v.map(function (r) { return String(r[i]).trim(); }).filter(String); };
  const managers = col(2).filter(function (m, i, a) { return a.indexOf(m) === i; });
  if (managers.indexOf(BOSS) < 0) managers.unshift(BOSS);
  return { sources: col(0), services: col(1), managers: managers };
}

function readLeads_() {
  const sh = leadsSheet_();
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const v = sh.getRange(2, 1, n, COLS.length).getDisplayValues();
  const out = [];
  v.forEach(function (r, i) {
    if (!r[0]) return;
    const o = { _row: i + 2 };
    F.forEach(function (f, j) { o[f] = String(r[j]); });
    out.push(o);
  });
  return out;
}

function writeLead_(sh, lead) {
  const row = F.map(function (f) { return lead[f] === undefined || lead[f] === null ? '' : String(lead[f]); });
  if (lead._row) sh.getRange(lead._row, 1, 1, F.length).setValues([row]);
  else {
    const r = sh.getLastRow() + 1;
    sh.getRange(r, 1, 1, F.length).setNumberFormat('@').setValues([row]);
    lead._row = r;
  }
}

function publicLead_(l) {
  const o = {};
  F.forEach(function (f) { o[f] = l[f] || ''; });
  o.status = stageCode_(l.status);
  return o;
}
