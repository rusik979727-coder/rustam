/**
 * ============================================================
 *  БЕЛЕС CRM — БІР ФАЙЛДЫҚ НҰСҚА
 *  Осы файлдың бәрін көшіріп, Apps Script-тегі Code.gs ішіне қойыңыз.
 *  Index.html файлы керек емес — бет осы файлдың соңында тұр.
 * ============================================================
 */
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
  const key = String(e.parameter.k).replace(/[^A-Za-z0-9]/g, '');
  return HtmlService.createHtmlOutput(INDEX_HTML.replace('<?= key ?>', key))
    .setTitle('Белес CRM · ' + user.name).addMetaTag('viewport', 'width=device-width, initial-scale=1');
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
    if (input.created !== undefined && input.id) {
      if (!DT.test(input.created)) throw new Error('Келген күні дұрыс емес.');
      if (input.created.slice(0, 10) > now.slice(0, 10)) throw new Error('Келген күні болашақта бола алмайды.');
      set('created', input.created, 'Келген күні');
    }
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
    const ad = body.ad && typeof body.ad === 'object' ? body.ad : null;
    const adLine = ad ? cut_('Жарнама: ' + [ad.headline, ad.source_id && ('ID ' + ad.source_id), ad.source_url].filter(String).join(' · '), 500) : '';
    const dup = all.filter(function (l) { return l.phone === phone; })[0];
    if (dup) {
      let line = now + ' · WhatsApp · Қайта жазды' + (text ? ': ' + text : '');
      if (adLine) line += ' · ' + adLine;
      const code = stageCode_(dup.status);
      if (code === 'refused' || code === 'noshow') {
        dup.status = STAGE_LABEL['new'];
        line += ' · Кезең: ' + STAGE_LABEL[code] + ' → ' + STAGE_LABEL['new'];
      }
      if (!dup.name && body.name) dup.name = cut_(body.name, 100);
      dup.updated = now;
      dup.history = addHistory_(dup.history, line);
      writeLead_(sh, dup);
      return json_({ ok: true, id: dup.id, existing: true });
    }
    const s = settings_();
    const lead = {
      id: 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
      created: now, name: cut_(body.name || p.name, 100), phone: phone,
      source: cut_(body.source || p.source || 'WhatsApp', 100), service: '', status: 'Новый',
      manager: nextManager_(s.managers), nextCall: '', appt: '', note: text, updated: now,
      history: now + ' · WhatsApp · Лид автоматты түрде түсті' + (text ? ': ' + text : '') + (adLine ? ' · ' + adLine : '')
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

/** CRM кестесі. Скрипт кестенің ішінде болса — сол кесте, бөлек жоба болса — осы ID. */
const CRM_SHEET_ID = '18UamClXbiihmyE7qpY5FwbiTY_S8PZ0hPCGhsdX4jRU';
function ss_() {
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  return ss || SpreadsheetApp.openById(CRM_SHEET_ID);
}
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


/* ---------- приложениенің беті (HTML) ---------- */
const INDEX_HTML = "<!DOCTYPE html>\n<html lang=\"kk\">\n<head>\n<base target=\"_top\">\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n<link rel=\"preconnect\" href=\"https://fonts.googleapis.com\">\n<link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Unbounded:wght@500;600&display=swap\">\n<style>\n/* Layout: phone-first lead desk — header, tabs, a working list; a lead opens as a full-height card on top. */\n[hidden]{display:none!important}\n:root{\n  --bg:#F2F5F4; --surface:#FFFFFF; --sunk:#E8EEEC; --ink:#13201C; --muted:#5A6A65; --line:#D7E0DC;\n  --accent:#0F7A63; --accent-ink:#FFFFFF; --accent-soft:#DCEFE8; --money:#A9661A;\n  --bad:#B83A2E; --bad-soft:#F7E1DE; --warn:#946A00; --warn-soft:#F6EDCF; --good:#1D7A43; --good-soft:#DDF1E4;\n  --wa:#1F8F4E;\n  --display:\"Unbounded\",\"Manrope\",system-ui,sans-serif;\n  --body:\"Manrope\",system-ui,-apple-system,\"Segoe UI\",sans-serif;\n  --r:12px;\n}\n@media (prefers-color-scheme: dark){:root{\n  --bg:#0D1412; --surface:#151E1B; --sunk:#1B2622; --ink:#E5EDEA; --muted:#93A39E; --line:#27332F;\n  --accent:#3EC29F; --accent-ink:#06231B; --accent-soft:#163A30; --money:#E2A24C;\n  --bad:#F07A6C; --bad-soft:#3A1F1C; --warn:#E3BC52; --warn-soft:#352C14; --good:#5BCB89; --good-soft:#163323; --wa:#3FBF73; color-scheme:dark}}\n*{box-sizing:border-box}\nhtml{-webkit-text-size-adjust:100%}\nbody{margin:0;background:var(--bg);color:var(--ink);font-family:var(--body);font-size:15px;line-height:1.45;\n  padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:16px 48px}\n.app{max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:14px}\n#view{display:flex;flex-direction:column;gap:14px}\nbutton,select,input,textarea{font:inherit;color:inherit}\n:focus-visible{outline:2px solid var(--accent);outline-offset:2px}\n.num{font-variant-numeric:tabular-nums}\n.top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;justify-content:space-between}\n.brand h1{font-family:var(--display);font-weight:600;font-size:21px;margin:0;letter-spacing:-.01em}\n.brand small{color:var(--muted);font-size:13px}\n.ctrls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}\nselect,.btn{height:40px;border-radius:10px;border:1px solid var(--line);background:var(--surface);padding:0 12px;cursor:pointer}\n.btn:hover{border-color:var(--accent)}\n.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent);font-weight:700}\n.btn.wa{background:var(--wa);border-color:var(--wa);color:#fff;font-weight:700;text-decoration:none;display:inline-flex;align-items:center}\n.btn.ghost{background:transparent}\n.btn[disabled]{opacity:.55;cursor:wait}\na.btn{display:inline-flex;align-items:center;text-decoration:none;color:var(--ink)}\n.lang{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;height:40px}\n.lang button{border:0;background:var(--surface);padding:0 10px;font-weight:700;font-size:12.5px;cursor:pointer;color:var(--muted)}\n.lang button[aria-pressed=\"true\"]{background:var(--ink);color:var(--bg)}\n.tabs{display:flex;gap:4px;background:var(--sunk);padding:4px;border-radius:12px;overflow-x:auto}\n.tabs a{flex:1 0 auto;text-align:center;padding:9px 12px;border-radius:9px;color:var(--muted);text-decoration:none;font-weight:600;font-size:14px;white-space:nowrap}\n.tabs a[aria-current=\"page\"]{background:var(--surface);color:var(--ink);box-shadow:0 1px 2px rgb(0 0 0 / .08)}\nh2{font-family:var(--display);font-weight:500;font-size:16px;margin:0}\n.label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:700}\n.sub{color:var(--muted);font-size:13px}\n.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}\n.panel-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}\n.bar-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center}\n.search{flex:1 1 180px;height:40px;border-radius:10px;border:1px solid var(--line);background:var(--surface);padding:0 12px;min-width:0}\n.chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}\n.chip{flex:0 0 auto;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:6px 12px;font-weight:600;font-size:13.5px;cursor:pointer;white-space:nowrap}\n.chip b{font-weight:700;color:var(--muted);margin-left:4px}\n.chip[aria-pressed=\"true\"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}\n.chip[aria-pressed=\"true\"] b{color:var(--bg)}\n.list{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}\n.row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 12px;padding:12px 14px;border:0;border-bottom:1px solid var(--line);background:none;text-align:left;cursor:pointer;width:100%}\n.row:last-child{border-bottom:0}\n.row:hover{background:var(--sunk)}\n.row .nm{font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.row .meta{grid-column:1 / -1;color:var(--muted);font-size:12.5px;display:flex;gap:4px 10px;flex-wrap:wrap}\n.row .due{color:var(--bad);font-weight:700}\n.pill{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap;align-self:start;background:var(--sunk);color:var(--muted)}\n.s-new{background:var(--accent-soft);color:var(--accent)}\n.s-noans,.s-noshow{background:var(--warn-soft);color:var(--warn)}\n.s-booked,.s-came{background:var(--good-soft);color:var(--good)}\n.s-bought{background:var(--good);color:var(--surface)}\n.s-refused{background:var(--bad-soft);color:var(--bad)}\n.empty{padding:28px 16px;text-align:center;color:var(--muted)}\n.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:var(--r);overflow:hidden}\n.kpi{background:var(--surface);padding:14px 16px;display:flex;flex-direction:column;gap:4px;min-width:0}\n.kpi b{font-family:var(--display);font-weight:500;font-size:23px;letter-spacing:-.02em;white-space:nowrap}\n@media (max-width:640px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.kpi b{font-size:20px}}\n.funnel{display:flex;flex-direction:column;gap:10px}\n.fstep{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:4px 10px;align-items:baseline}\n.fstep .bar{grid-column:1 / -1;height:10px;border-radius:5px;background:var(--sunk);overflow:hidden}\n.fstep .bar i{display:block;height:100%;background:var(--accent);border-radius:5px}\n.fstep .v{font-weight:700}\n.fstep .pct{color:var(--muted);font-weight:500;font-size:12.5px;margin-left:6px}\n.scroll{overflow-x:auto;border:1px solid var(--line);border-radius:10px}\ntable{border-collapse:collapse;font-size:13.5px;font-variant-numeric:tabular-nums;min-width:100%}\nth,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}\nth:first-child,td:first-child{text-align:left}\nthead th{background:var(--sunk);font-size:12px;color:var(--muted);font-weight:700}\ntbody tr:last-child td{border-bottom:0}\n.report{width:100%;min-height:200px;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:12px;font-size:14px;line-height:1.55;resize:vertical}\n.fab{position:fixed;right:max(16px,env(safe-area-inset-right,0px));bottom:calc(16px + env(safe-area-inset-bottom,0px));height:54px;padding:0 20px;border-radius:999px;border:0;background:var(--accent);color:var(--accent-ink);font-weight:700;font-size:16px;box-shadow:0 6px 18px rgb(0 0 0 / .18);cursor:pointer;z-index:15}\n\n/* lead card */\n.sheet{position:fixed;inset:0;background:rgb(0 0 0 / .35);z-index:30;display:flex;justify-content:center;align-items:flex-end}\n.card{background:var(--bg);width:100%;max-width:640px;max-height:100%;overflow-y:auto;border-radius:16px 16px 0 0;\n  padding:16px max(16px,env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:14px}\n@media (min-width:700px){.sheet{align-items:center;padding:24px}.card{border-radius:16px;max-height:calc(100% - 48px)}}\n.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}\n.card-head h2{font-size:19px}\n.x{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:var(--surface);cursor:pointer;font-size:20px;line-height:1;flex:0 0 auto}\n.contact{display:flex;gap:8px;flex-wrap:wrap}\n.fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}\n@media (max-width:520px){.fields{grid-template-columns:minmax(0,1fr)}}\n.field{display:flex;flex-direction:column;gap:5px;min-width:0}\n.field.wide{grid-column:1 / -1}\n.field label{font-size:13px;font-weight:600;color:var(--muted)}\n.field input,.field select,.field textarea{min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface);padding:8px 12px;width:100%}\n.field textarea{min-height:80px;resize:vertical}\n.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px var(--accent-soft)}\n.status-grid{display:flex;flex-wrap:wrap;gap:6px}\n.status-grid button{border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:8px 13px;cursor:pointer;font-weight:600;font-size:14px}\n.status-grid button[aria-pressed=\"true\"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}\n.quick{display:flex;gap:6px;flex-wrap:wrap}\n.quick button{border:1px dashed var(--line);background:none;border-radius:8px;padding:5px 10px;font-size:13px;cursor:pointer;color:var(--muted);font-weight:600}\n.hist{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;font-size:13.5px}\n.hist li{padding:8px 10px;border-radius:8px;background:var(--surface);border:1px solid var(--line)}\n.hist time{display:block;font-size:12px;color:var(--muted);font-weight:600}\n.msg{font-size:14px}\n.msg.err{color:var(--bad);font-weight:600}\n.notice{padding:10px 12px;border-radius:10px;background:var(--warn-soft);font-size:14px}\n.state{padding:24px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);display:flex;flex-direction:column;gap:10px;align-items:flex-start}\n.state p{margin:0;color:var(--muted)}\n.skeleton{height:72px;border-radius:var(--r);background:linear-gradient(90deg,var(--sunk),var(--surface),var(--sunk));background-size:200% 100%;animation:sh 1.4s linear infinite}\n@keyframes sh{to{background-position:-200% 0}}\n@media (prefers-reduced-motion:reduce){.skeleton{animation:none}}\n\n/* board */\n.quickadd{display:flex;gap:8px}\n.quickadd input{flex:1 1 auto;min-width:0;height:48px;border-radius:12px;border:1px solid var(--line);background:var(--surface);padding:0 14px;font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}\n.quickadd input:focus{border-color:var(--accent);outline:none;box-shadow:0 0 0 3px var(--accent-soft)}\n.quickadd .btn{height:48px;font-size:15px;padding:0 18px}\n.stages{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}\n.board{display:flex;gap:12px;align-items:flex-start}\n.col{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:8px}\n.col:not(.active){display:none}\n.col-head{display:none;justify-content:space-between;align-items:baseline;gap:8px;padding:0 4px}\n.col-head h3{margin:0;font-size:14px;font-weight:700}\n.col-head b{color:var(--muted);font-weight:700;font-size:13px}\n@media (min-width:1000px){\n  .app{max-width:1400px}\n  .stages{display:none}\n  .board{overflow-x:auto;padding-bottom:6px}\n  .col,.col:not(.active){display:flex;flex:0 0 290px}\n  .col-head{display:flex}\n}\n.lead{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:8px}\n.lead.due{border-color:var(--bad)}\n.lead-top{display:flex;justify-content:space-between;align-items:center;gap:8px}\n.ph{border:0;background:none;padding:0;font-weight:700;font-size:16.5px;font-variant-numeric:tabular-nums;cursor:pointer;color:var(--ink);text-align:left}\n.ph:hover{color:var(--accent)}\n.wa-mini{display:inline-flex;align-items:center;justify-content:center;height:30px;padding:0 12px;border-radius:999px;background:var(--wa);color:#fff;font-weight:700;font-size:12.5px;text-decoration:none;flex:0 0 auto}\n.lead .meta{color:var(--muted);font-size:12.5px;display:flex;gap:2px 10px;flex-wrap:wrap;align-items:center}\n.lead .meta .due{color:var(--bad);font-weight:700}\n.moves{display:flex;gap:6px;flex-wrap:wrap}\n.mv{border:1px solid var(--line);background:var(--bg);border-radius:8px;padding:7px 10px;font-size:13px;font-weight:700;cursor:pointer;color:var(--ink)}\n.mv:hover{border-color:var(--accent)}\n.mv[disabled]{opacity:.5;cursor:wait}\n.mv.m-refused{color:var(--bad)}\n.mv.m-booked,.mv.m-came,.mv.m-bought{color:var(--good)}\n.mv.m-noans,.mv.m-noshow{color:var(--warn)}\n.s-work{background:var(--sunk);color:var(--ink)}\n.dayhead{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);padding:6px 4px 0}\n.lead .meta .arrived{color:var(--ink);font-weight:700}\n.datepick{height:33px;padding:0 10px;font-size:13px}\n.col-empty{padding:18px 12px;text-align:center;color:var(--muted);font-size:13.5px;border:1px dashed var(--line);border-radius:12px}\n#toast{position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:10px;font-weight:600;z-index:40;max-width:calc(100% - 32px)}\n</style>\n</head>\n<body>\n<div id=\"cfg\" data-key=\"<?= key ?>\" hidden></div>\n<div class=\"app\">\n  <header class=\"top\">\n    <div class=\"brand\"><h1>Белес CRM</h1><small id=\"who\"></small></div>\n    <div class=\"ctrls\">\n      <div class=\"lang\" role=\"group\" aria-label=\"Тіл / Язык\"><button type=\"button\" data-lang=\"kk\">ҚАЗ</button><button type=\"button\" data-lang=\"ru\">РУС</button></div>\n      <button class=\"btn\" id=\"reload\" type=\"button\"></button>\n    </div>\n  </header>\n  <nav class=\"tabs\" aria-label=\"Sections\">\n    <a href=\"#voronka\" data-v=\"voronka\"></a>\n    <a href=\"#esep\" data-v=\"esep\"></a>\n    <a href=\"#taldau\" data-v=\"taldau\"></a>\n  </nav>\n  <main id=\"view\"><div class=\"skeleton\"></div><div class=\"skeleton\"></div></main>\n</div>\n<div class=\"sheet\" id=\"sheet\" hidden></div>\n<div id=\"toast\" hidden></div>\n\n<script>\nconst KEY = document.getElementById(\"cfg\").dataset.key;\nconst STAGES = [\"new\",\"work\",\"noans\",\"booked\",\"came\",\"noshow\",\"bought\",\"refused\"];\nconst SN = {\n  kk:{new:\"Жаңа\",work:\"Обработка\",noans:\"Не ответил\",booked:\"Запись\",came:\"Пришёл\",noshow:\"Не пришёл\",bought:\"Купил\",refused:\"Отказ\"},\n  ru:{new:\"Новый\",work:\"Обработка\",noans:\"Не ответил\",booked:\"Запись\",came:\"Пришёл\",noshow:\"Не пришёл\",bought:\"Купил\",refused:\"Отказ\"}\n};\nconst ST_CLASS = {new:\"s-new\",work:\"s-work\",noans:\"s-noans\",booked:\"s-booked\",came:\"s-came\",noshow:\"s-noshow\",bought:\"s-bought\",refused:\"s-refused\"};\n/** Әр кезеңнен қайда жылжытуға болады. */\nconst MOVES = {\n  new:[\"work\",\"noans\",\"booked\",\"refused\"], work:[\"noans\",\"booked\",\"refused\"], noans:[\"work\",\"booked\",\"refused\"],\n  booked:[\"came\",\"noshow\",\"refused\"], came:[\"bought\",\"refused\"], noshow:[\"work\",\"booked\",\"refused\"], bought:[], refused:[\"work\"]\n};\nconst OPEN = [\"new\",\"work\",\"noans\"];\nconst BOOKED = [\"booked\",\"came\",\"noshow\",\"bought\"];\nconst T = {\n  kk:{ tabs:{voronka:\"Воронка\",esep:\"Бүгінгі есеп\",taldau:\"Талдау\"}, reload:\"Жаңарту\", add:\"Қосу\", addPh:\"Жаңа нөмір: +7 701 123 45 67\", search:\"Нөмір бойынша іздеу…\",\n    due:\"Бүгін хабарласу керек\", none:\"Бос\", nofound:\"Бұл нөмір табылмады\", added:\"Қосылды: Жаңа\", manager:\"Менеджер\", allm:\"Барлық менеджер\",\n    since:\"Келді\", next:\"Байланыс\", createdF:\"Келген күні мен уақыты\", dAll:\"Барлық күн\", dToday:\"Бүгін\", dYest:\"Кеше\", d7:\"7 күн\", dPick:\"Күнді таңдау\", appt:\"Жазылу\", phone:\"Телефон\", source:\"Жарнама\", service:\"Қызмет\", stage:\"Кезең\", nextCall:\"Келесі байланыс\", apptF:\"Жазылу уақыты\",\n    note:\"Ескерту\", comment:\"Пікір қосу\", comment_ph:\"Мысалы: кешке қоңырау шалуды сұрады\", save:\"Сақтау\", saving:\"Сақталуда…\", saved:\"Сақталды\",\n    wa:\"WhatsApp\", call:\"Қоңырау\", hist:\"Тарих\", open:\"Ашу\", q:{h2:\"2 сағаттан\",tom:\"Ертең 10:00\",d3:\"3 күннен\",clr:\"Тазалау\"},\n    dup:\"Бұл нөмір бұрын енгізілген — карточкасы ашылды.\", dupOther:m=>`Бұл нөмір бар, ол ${m} менеджеріне бекітілген.`, phoneBad:\"Нөмір дұрыс емес.\",\n    moved:(p,s)=>`${p} → ${s}`, moveErr:\"Жылжытылмады:\", setAppt:\"Жазылу уақытын қойыңыз\",\n    rep:\"Бүгінгі есеп\", rep_sub:\"негізгі приложениедегі «Күнді енгізу» бөліміне көшіріңіз\", day:\"Күн\", copy:\"Көшіру\", copied:\"Көшірілді\", copyfail:\"Мәтін белгіленді, Ctrl+C басыңыз.\",\n    r_kk:[\"Жаңа лидтер\",\"Жазылды\",\"Жауап бермеді\",\"Жұмыста\",\"Бас тартты\",\"Конверсия\"], total:\"Барлығы\",\n    p7:\"7 күн\", p30:\"30 күн\", pall:\"Барлығы\", fun:\"Воронка\", f:[\"Лидтер\",\"Жазылды\",\"Келді\",\"Сатып алды\"], ofprev:\"алдыңғыдан\",\n    bySource:\"Жарнамалар бойынша\", byMgr:\"Менеджерлер бойынша\", conv:\"Сатып алу %\", leads:\"Лидтер\", booked:\"Жазылды\", came:\"Келді\", bought:\"Сатып алды\",\n    k:[\"Лидтер\",\"Жазылды\",\"Жазылу %\",\"Сатып алды\",\"Жұмыста\",\"Мерзімі өткен\"], err:\"Деректерді жүктеу мүмкін болмады\", saveErr:\"Сақталмады:\", ago:\"бұрын\" },\n  ru:{ tabs:{voronka:\"Воронка\",esep:\"Отчёт за день\",taldau:\"Аналитика\"}, reload:\"Обновить\", add:\"Добавить\", addPh:\"Новый номер: +7 701 123 45 67\", search:\"Поиск по номеру…\",\n    due:\"Связаться сегодня\", none:\"Пусто\", nofound:\"Номер не найден\", added:\"Добавлен: Новый\", manager:\"Менеджер\", allm:\"Все менеджеры\",\n    since:\"Пришёл\", next:\"Контакт\", createdF:\"Дата и время поступления\", dAll:\"Все дни\", dToday:\"Сегодня\", dYest:\"Вчера\", d7:\"7 дней\", dPick:\"Выбрать день\", appt:\"Запись\", phone:\"Телефон\", source:\"Реклама\", service:\"Услуга\", stage:\"Этап\", nextCall:\"Следующий контакт\", apptF:\"Время записи\",\n    note:\"Заметка\", comment:\"Добавить комментарий\", comment_ph:\"Например: просил перезвонить вечером\", save:\"Сохранить\", saving:\"Сохраняю…\", saved:\"Сохранено\",\n    wa:\"WhatsApp\", call:\"Позвонить\", hist:\"История\", open:\"Открыть\", q:{h2:\"Через 2 часа\",tom:\"Завтра 10:00\",d3:\"Через 3 дня\",clr:\"Очистить\"},\n    dup:\"Этот номер уже есть — открыта его карточка.\", dupOther:m=>`Этот номер уже есть, он закреплён за менеджером ${m}.`, phoneBad:\"Неверный номер.\",\n    moved:(p,s)=>`${p} → ${s}`, moveErr:\"Не перемещено:\", setAppt:\"Укажите время записи\",\n    rep:\"Отчёт за день\", rep_sub:\"перенесите в «Ввод за день» основного приложения\", day:\"День\", copy:\"Скопировать\", copied:\"Скопировано\", copyfail:\"Текст выделен, нажмите Ctrl+C.\",\n    r_kk:[\"Кол-во новых лидов\",\"Запись\",\"Недозвон\",\"В работе\",\"Отказ\",\"Конверсия\"], total:\"Всего\",\n    p7:\"7 дней\", p30:\"30 дней\", pall:\"Всё время\", fun:\"Воронка\", f:[\"Лиды\",\"Записались\",\"Пришли\",\"Купили\"], ofprev:\"от пред.\",\n    bySource:\"По рекламе\", byMgr:\"По менеджерам\", conv:\"Покупка %\", leads:\"Лиды\", booked:\"Запись\", came:\"Пришли\", bought:\"Купили\",\n    k:[\"Лиды\",\"Записались\",\"Запись %\",\"Купили\",\"В работе\",\"Просрочено\"], err:\"Не удалось загрузить данные\", saveErr:\"Не сохранилось:\", ago:\"назад\" }\n};\nconst REP_RU = [\"Кол-во новых лидов\",\"Запись\",\"Недозвон\",\"В работе\",\"Отказ\",\"Конверсия\"];\nlet LANG = \"kk\"; try { const s = localStorage.getItem(\"beles_lang\"); if (s===\"ru\"||s===\"kk\") LANG = s; } catch {}\nconst t = k => T[LANG][k];\nconst sn = c => SN[LANG][c] || c;\n\nconst S = { me:\"\", boss:false, leads:[], sources:[], services:[], managers:[], loaded:false, err:null,\n  q:\"\", stage:\"new\", mgr:\"\", dayF:\"all\", repDay:null, period:30, open:null, busy:new Set() };\nconst $ = s => document.querySelector(s);\nconst esc = s => String(s ?? \"\").replace(/[&<>\"']/g, c => ({\"&\":\"&amp;\",\"<\":\"&lt;\",\">\":\"&gt;\",'\"':\"&quot;\",\"'\":\"&#39;\"}[c]));\nconst nf0 = new Intl.NumberFormat(\"ru-RU\",{maximumFractionDigits:0});\nconst nf1 = new Intl.NumberFormat(\"ru-RU\",{maximumFractionDigits:1});\nconst gs = (fn, ...a) => new Promise((res, rej) => google.script.run.withSuccessHandler(res).withFailureHandler(rej)[fn](...a));\nconst pad = n => String(n).padStart(2,\"0\");\nconst fmtDT = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;\nconst parseDT = s => s ? new Date(String(s).replace(\" \",\"T\")) : null;\nconst dayKey = s => String(s||\"\").slice(0,10);\nconst todayKey = () => fmtDT(new Date()).slice(0,10);\nfunction human(s){ if(!s) return \"\"; const d=parseDT(s); if(isNaN(d)) return s; const k=dayKey(s); const tm=`${pad(d.getHours())}:${pad(d.getMinutes())}`;\n  const off = n => { const x=new Date(); x.setDate(x.getDate()+n); return fmtDT(x).slice(0,10); };\n  if(k===off(0)) return (LANG===\"ru\"?\"сегодня \":\"бүгін \")+tm; if(k===off(-1)) return (LANG===\"ru\"?\"вчера \":\"кеше \")+tm; if(k===off(1)) return (LANG===\"ru\"?\"завтра \":\"ертең \")+tm;\n  return `${pad(d.getDate())}.${pad(d.getMonth()+1)} ${tm}`; }\nconst normPhone = v => { let d=String(v||\"\").replace(/\\D/g,\"\"); if(d.length===11&&d[0]===\"8\") d=\"7\"+d.slice(1); if(d.length===10) d=\"7\"+d; return d.length>=10&&d.length<=15?d:\"\"; };\nconst phoneFmt = p => { const d=String(p||\"\"); return d.length===11 && d[0]===\"7\" ? `+7 ${d.slice(1,4)} ${d.slice(4,7)} ${d.slice(7,9)} ${d.slice(9)}` : (d?\"+\"+d:\"\"); };\nconst offKey = n => { const x=new Date(); x.setDate(x.getDate()+n); return fmtDT(x).slice(0,10); };\nfunction dayTitle(k){ const [y,m,d]=k.split(\"-\"); const base=`${d}.${m}.${y}`;\n  if (k===offKey(0)) return `${LANG===\"ru\"?\"Сегодня\":\"Бүгін\"} · ${base}`; if (k===offKey(-1)) return `${LANG===\"ru\"?\"Вчера\":\"Кеше\"} · ${base}`; return base; }\nconst fullDT = s => { const k=dayKey(s); if(!k) return \"\"; const [y,m,d]=k.split(\"-\"); return `${d}.${m}.${y} ${String(s).slice(11,16)}`; };\nfunction dayOk(l){ const k=dayKey(l.created), f=S.dayF;\n  if (f===\"all\") return true; if (f===\"today\") return k===offKey(0); if (f===\"yest\") return k===offKey(-1); if (f===\"7\") return k>=offKey(-6); return k===f; }\nconst isDue = l => l.nextCall && OPEN.includes(l.status) && parseDT(l.nextCall) <= new Date();\nlet toastT; function toast(x){ const el=$(\"#toast\"); el.textContent=x; el.hidden=false; clearTimeout(toastT); toastT=setTimeout(()=>el.hidden=true,2600); }\n\nasync function load(){\n  $(\"#reload\").disabled = true;\n  try { const d = await gs(\"crmData\", KEY); Object.assign(S, {me:d.me, boss:d.boss, leads:d.leads, sources:d.sources, services:d.services, managers:d.managers, loaded:true, err:null}); }\n  catch(e){ S.err = String((e && e.message) || e); }\n  $(\"#reload\").disabled = false; render();\n}\nfunction route(){ const h=location.hash.slice(1); return [\"voronka\",\"esep\",\"taldau\"].includes(h) ? h : \"voronka\"; }\nfunction chrome(){\n  document.documentElement.lang = LANG;\n  document.querySelectorAll(\".lang button\").forEach(b=>b.setAttribute(\"aria-pressed\", b.dataset.lang===LANG));\n  document.querySelectorAll(\".tabs a\").forEach(a=>{ a.textContent=t(\"tabs\")[a.dataset.v]; a.setAttribute(\"aria-current\", a.dataset.v===route()?\"page\":\"false\"); });\n  $(\"#reload\").textContent = t(\"reload\");\n  $(\"#who\").textContent = S.me ? (S.boss ? `${S.me} · ${LANG===\"ru\"?\"все лиды\":\"барлық лидтер\"}` : S.me) : \"\";\n}\nfunction render(){\n  chrome();\n  const el = $(\"#view\");\n  if (S.err && !S.loaded){ el.innerHTML = `<div class=\"state\"><h2>${esc(t(\"err\"))}</h2><p>${esc(S.err)}</p><button class=\"btn primary\" id=\"retry\" type=\"button\">${esc(t(\"reload\"))}</button></div>`; $(\"#retry\").onclick=load; return; }\n  if (!S.loaded) return;\n  const v = route();\n  if (v===\"voronka\"){ const keep = captureFocus(); el.innerHTML = viewBoard(); bindBoard(); restoreFocus(keep); }\n  if (v===\"esep\"){ el.innerHTML = viewReport(); bindReport(); }\n  if (v===\"taldau\"){ el.innerHTML = viewStats(); bindStats(); }\n}\nfunction captureFocus(){ const a=document.activeElement; return a && a.id && /^(q|newPhone)$/.test(a.id) ? {id:a.id, pos:a.selectionStart} : null; }\nfunction restoreFocus(k){ if(!k) return; const n=document.getElementById(k.id); if(n){ n.focus(); try{ n.setSelectionRange(k.pos,k.pos); }catch{} } }\n\n/* ---------- воронка ---------- */\nconst scoped = () => S.leads.filter(l => (!S.mgr || l.manager===S.mgr));\nconst scopedDay = () => scoped().filter(dayOk);\nfunction leadHtml(l){\n  const due = isDue(l), digits = String(l.phone||\"\");\n  const meta = [];\n  if (l.source) meta.push(esc(l.source));\n  if (S.boss && l.manager) meta.push(esc(l.manager));\n  if (l.status===\"booked\" && l.appt) meta.push(`${esc(t(\"appt\"))}: ${esc(human(l.appt))}`);\n  else if (l.nextCall && OPEN.includes(l.status)) meta.push(`<span class=\"${due?\"due\":\"\"}\">${esc(t(\"next\"))}: ${esc(human(l.nextCall))}</span>`);\n  meta.unshift(`<b class=\"arrived\">${esc(t(\"since\"))}: ${esc(fullDT(l.created))}</b>`);\n  const busy = S.busy.has(l.id);\n  const moves = MOVES[l.status].map(c=>`<button type=\"button\" class=\"mv m-${c}\" data-mv=\"${c}\" ${busy?\"disabled\":\"\"}>→ ${esc(sn(c))}</button>`).join(\"\");\n  return `<div class=\"lead ${due?\"due\":\"\"}\" data-id=\"${esc(l.id)}\">\n    <div class=\"lead-top\"><button type=\"button\" class=\"ph\" data-open=\"1\">${esc(phoneFmt(digits))}</button>\n      ${digits?`<a class=\"wa-mini\" href=\"https://wa.me/${esc(digits)}\" target=\"_blank\" rel=\"noopener\">WA</a>`:\"\"}</div>\n    <div class=\"meta\">${meta.map(m=>`<span>${m}</span>`).join(\"\")}</div>\n    ${moves?`<div class=\"moves\">${moves}</div>`:\"\"}</div>`;\n}\nfunction grouped(list){\n  let out=\"\", cur=\"\";\n  list.forEach(l=>{ const k=dayKey(l.created); if(k!==cur){ cur=k; out+=`<div class=\"dayhead\">${esc(dayTitle(k))}</div>`; } out+=leadHtml(l); });\n  return out;\n}\nfunction viewBoard(){\n  const base = scopedDay();\n  const qd = S.q.replace(/\\D/g,\"\");\n  const mgrSel = S.boss && S.managers.length>1 ? `<select id=\"mgr\" aria-label=\"${esc(t(\"manager\"))}\"><option value=\"\">${esc(t(\"allm\"))}</option>${S.managers.map(m=>`<option ${m===S.mgr?\"selected\":\"\"}>${esc(m)}</option>`).join(\"\")}</select>` : \"\";\n  const top = `<form class=\"quickadd\" id=\"addForm\" autocomplete=\"off\"><input id=\"newPhone\" type=\"tel\" inputmode=\"tel\" placeholder=\"${esc(t(\"addPh\"))}\" aria-label=\"${esc(t(\"addPh\"))}\"><button class=\"btn primary\" type=\"submit\">${esc(t(\"add\"))}</button></form>\n    <div class=\"bar-tools\"><input class=\"search\" id=\"q\" type=\"search\" inputmode=\"tel\" placeholder=\"${esc(t(\"search\"))}\" value=\"${esc(S.q)}\" autocomplete=\"off\">${mgrSel}</div>`;\n  if (qd){\n    const found = scoped().filter(l => l.phone.includes(qd)).sort((a,b)=>b.created.localeCompare(a.created));\n    return top + (found.length ? `<div class=\"col active\">${found.map(l=>leadHtml(l).replace('<div class=\"meta\">',`<div class=\"meta\"><span class=\"pill ${ST_CLASS[l.status]}\">${esc(sn(l.status))}</span>`)).join(\"\")}</div>`\n      : `<div class=\"col-empty\">${esc(t(\"nofound\"))}</div>`);\n  }\n  const by = {}; STAGES.forEach(c=>by[c]=[]); base.forEach(l=>(by[l.status]||by.new).push(l));\n  STAGES.forEach(c=>by[c].sort((a,b)=>b.created.localeCompare(a.created)));\n  const due = base.filter(isDue).length;\n  const chips = STAGES.map(c=>`<button type=\"button\" class=\"chip\" data-st=\"${c}\" aria-pressed=\"${S.stage===c}\">${esc(sn(c))}<b>${by[c].length}</b></button>`).join(\"\");\n  const cols = STAGES.map(c=>`<section class=\"col ${S.stage===c?\"active\":\"\"}\" data-col=\"${c}\"><div class=\"col-head\"><h3>${esc(sn(c))}</h3><b>${by[c].length}</b></div>\n    ${by[c].length ? grouped(by[c]) : `<div class=\"col-empty\">${esc(t(\"none\"))}</div>`}</section>`).join(\"\");\n  const dueNote = due ? `<div class=\"notice\">${esc(t(\"due\"))}: <b>${due}</b></div>` : \"\";\n  const fixed = [\"all\",\"today\",\"yest\",\"7\"], picked = !fixed.includes(S.dayF);\n  const dchips = [[\"all\",t(\"dAll\")],[\"today\",t(\"dToday\")],[\"yest\",t(\"dYest\")],[\"7\",t(\"d7\")]].map(([v,lab])=>`<button type=\"button\" class=\"chip\" data-d=\"${v}\" aria-pressed=\"${S.dayF===v}\">${esc(lab)}</button>`).join(\"\")\n    + `<input type=\"date\" class=\"chip datepick\" id=\"dayPick\" aria-label=\"${esc(t(\"dPick\"))}\" value=\"${picked?esc(S.dayF):\"\"}\" ${picked?'aria-pressed=\"true\"':\"\"}>`;\n  return top + `<div class=\"chips\" id=\"days\">${dchips}</div>` + dueNote + `<div class=\"stages\" id=\"stages\">${chips}</div><div class=\"board\" id=\"board\">${cols}</div>`;\n}\nfunction bindBoard(){\n  const q=$(\"#q\"); q.oninput = () => { S.q=q.value; render(); };\n  const m=$(\"#mgr\"); if(m) m.onchange = () => { S.mgr=m.value; render(); };\n  $(\"#days\").onclick = e => { const b=e.target.closest(\"button.chip\"); if(!b) return; S.dayF=b.dataset.d; render(); };\n  $(\"#dayPick\").onchange = e => { S.dayF = e.target.value || \"all\"; render(); };\n  const st=$(\"#stages\"); if(st) st.onclick = e => { const b=e.target.closest(\".chip\"); if(!b) return; S.stage=b.dataset.st; render(); };\n  $(\"#addForm\").onsubmit = async e => {\n    e.preventDefault();\n    const inp=$(\"#newPhone\"), phone=normPhone(inp.value);\n    if (!phone){ toast(t(\"phoneBad\")); inp.focus(); return; }\n    const local = S.leads.find(l=>l.phone===phone);\n    if (local){ inp.value=\"\"; openLead(local.id); toast(t(\"dup\")); return; }\n    inp.disabled = true;\n    try {\n      const r = await gs(\"crmSave\", KEY, {phone, status:\"new\"});\n      inp.disabled = false;\n      if (r.duplicate){ if (r.lead){ upsert(r.lead); inp.value=\"\"; openLead(r.lead.id); toast(t(\"dup\")); } else toast(t(\"dupOther\")(r.other)); return; }\n      upsert(r.lead); inp.value=\"\"; S.stage=\"new\"; S.q=\"\"; render(); toast(t(\"added\")); $(\"#newPhone\").focus();\n    } catch(err){ inp.disabled=false; toast(t(\"saveErr\")+\" \"+String((err&&err.message)||err)); }\n  };\n  $(\"#view\").onclick = e => {\n    const card = e.target.closest(\".lead\"); if (!card) return;\n    if (e.target.closest(\"[data-open]\")) { openLead(card.dataset.id); return; }\n    const mv = e.target.closest(\"[data-mv]\"); if (mv) move(card.dataset.id, mv.dataset.mv);\n  };\n}\nasync function move(id, to){\n  const l = S.leads.find(x=>x.id===id); if (!l || S.busy.has(id)) return;\n  const before = Object.assign({}, l);\n  const input = {id, status:to};\n  if (to===\"noans\" && (!l.nextCall || parseDT(l.nextCall) <= new Date())){ const d=new Date(); d.setHours(d.getHours()+2); input.nextCall = fmtDT(d); }\n  Object.assign(l, input); l.updated = fmtDT(new Date()); S.busy.add(id); render();\n  toast(t(\"moved\")(phoneFmt(l.phone), sn(to)));\n  try { const r = await gs(\"crmSave\", KEY, input); S.busy.delete(id); upsert(r.lead); render();\n    if (to===\"booked\" && !r.lead.appt){ openLead(id); toast(t(\"setAppt\")); setTimeout(()=>{ const a=$(\"#f_appt\"); if(a) a.focus(); }, 50); } }\n  catch(err){ S.busy.delete(id); Object.assign(l, before); render(); toast(t(\"moveErr\")+\" \"+String((err&&err.message)||err)); }\n}\nfunction upsert(lead){ const i=S.leads.findIndex(x=>x.id===lead.id); if(i>=0) S.leads[i]=lead; else S.leads.unshift(lead); }\n\n/* ---------- карточка ---------- */\nfunction openLead(id){\n  const l = S.leads.find(x=>x.id===id); if (!l) return;\n  S.open = Object.assign({}, l); renderCard();\n}\nconst toLocal = s => s ? s.replace(\" \",\"T\") : \"\";\nconst fromLocal = s => s ? s.replace(\"T\",\" \").slice(0,16) : \"\";\nfunction renderCard(){\n  const l = S.open, sh = $(\"#sheet\"), digits = String(l.phone||\"\");\n  const opt = (arr, v) => { const a = arr.slice(); if (v && !a.includes(v)) a.unshift(v); return `<option value=\"\"></option>` + a.map(x=>`<option ${x===v?\"selected\":\"\"}>${esc(x)}</option>`).join(\"\"); };\n  const hist = (l.history||\"\").split(\"\\n\").filter(Boolean).reverse().map(line=>{ const p=line.split(\" · \"); return `<li><time>${esc(p[0])} · ${esc(p[1]||\"\")}</time>${esc(p.slice(2).join(\" · \"))}</li>`; }).join(\"\");\n  sh.innerHTML = `<div class=\"card\" role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"cardTitle\">\n    <div class=\"card-head\"><div><span class=\"pill ${ST_CLASS[l.status]}\">${esc(sn(l.status))}</span><h2 id=\"cardTitle\" class=\"num\" style=\"margin-top:6px\">${esc(phoneFmt(digits))}</h2><span class=\"sub\">${esc(t(\"since\"))}: ${esc(fullDT(l.created))}${l.name?\" · \"+esc(l.name):\"\"}</span></div>\n      <button class=\"x\" type=\"button\" id=\"close\" aria-label=\"×\">×</button></div>\n    <div class=\"contact\"><a class=\"btn wa\" href=\"https://wa.me/${esc(digits)}\" target=\"_blank\" rel=\"noopener\">${esc(t(\"wa\"))}</a><a class=\"btn\" href=\"tel:+${esc(digits)}\">${esc(t(\"call\"))}</a></div>\n    <form id=\"leadForm\" class=\"panel\" autocomplete=\"off\">\n      <div class=\"fields\">\n        <div class=\"field wide\"><label>${esc(t(\"stage\"))}</label><div class=\"status-grid\" id=\"stGrid\">${STAGES.map(c=>`<button type=\"button\" data-s=\"${c}\" aria-pressed=\"${c===l.status}\">${esc(sn(c))}</button>`).join(\"\")}</div></div>\n        <div class=\"field\"><label for=\"f_created\">${esc(t(\"createdF\"))}</label><input id=\"f_created\" type=\"datetime-local\" value=\"${esc(toLocal(l.created))}\" max=\"${esc(todayKey())}T23:59\"></div>\n        <div class=\"field\"><label for=\"f_phone\">${esc(t(\"phone\"))}</label><input id=\"f_phone\" type=\"tel\" inputmode=\"tel\" value=\"${esc(phoneFmt(digits))}\"></div>\n        <div class=\"field\"><label for=\"f_source\">${esc(t(\"source\"))}</label><select id=\"f_source\">${opt(S.sources, l.source)}</select></div>\n        <div class=\"field\"><label for=\"f_service\">${esc(t(\"service\"))}</label><input id=\"f_service\" list=\"svc\" value=\"${esc(l.service)}\" maxlength=\"100\"><datalist id=\"svc\">${S.services.map(x=>`<option>${esc(x)}</option>`).join(\"\")}</datalist></div>\n        ${S.boss && S.managers.length>1 ? `<div class=\"field\"><label for=\"f_manager\">${esc(t(\"manager\"))}</label><select id=\"f_manager\">${S.managers.map(m=>`<option ${m===l.manager?\"selected\":\"\"}>${esc(m)}</option>`).join(\"\")}</select></div>` : \"\"}\n        <div class=\"field\" id=\"wrapNext\"><label for=\"f_next\">${esc(t(\"nextCall\"))}</label><input id=\"f_next\" type=\"datetime-local\" value=\"${esc(toLocal(l.nextCall))}\">\n          <div class=\"quick\" id=\"quick\"><button type=\"button\" data-q=\"h2\">${esc(t(\"q\").h2)}</button><button type=\"button\" data-q=\"tom\">${esc(t(\"q\").tom)}</button><button type=\"button\" data-q=\"d3\">${esc(t(\"q\").d3)}</button><button type=\"button\" data-q=\"clr\">${esc(t(\"q\").clr)}</button></div></div>\n        <div class=\"field\" id=\"wrapAppt\"><label for=\"f_appt\">${esc(t(\"apptF\"))}</label><input id=\"f_appt\" type=\"datetime-local\" value=\"${esc(toLocal(l.appt))}\"></div>\n        <div class=\"field wide\"><label for=\"f_note\">${esc(t(\"note\"))}</label><textarea id=\"f_note\" maxlength=\"2000\">${esc(l.note)}</textarea></div>\n        <div class=\"field wide\"><label for=\"f_comment\">${esc(t(\"comment\"))}</label><input id=\"f_comment\" maxlength=\"1000\" placeholder=\"${esc(t(\"comment_ph\"))}\"></div>\n      </div>\n      <div class=\"bar-tools\"><button class=\"btn primary\" type=\"submit\" id=\"saveLead\">${esc(t(\"save\"))}</button><span class=\"msg\" id=\"leadMsg\"></span></div>\n    </form>\n    ${hist ? `<section class=\"panel\"><h2>${esc(t(\"hist\"))}</h2><ul class=\"hist\">${hist}</ul></section>` : \"\"}\n  </div>`;\n  sh.hidden = false; document.body.style.overflow = \"hidden\";\n  const close = () => { sh.hidden = true; sh.innerHTML = \"\"; document.body.style.overflow = \"\"; S.open = null; };\n  $(\"#close\").onclick = close;\n  sh.onclick = e => { if (e.target === sh) close(); };\n  document.onkeydown = e => { if (e.key===\"Escape\" && !sh.hidden) close(); };\n  const syncVis = () => { $(\"#wrapAppt\").hidden = !BOOKED.includes(l.status) && !$(\"#f_appt\").value; $(\"#wrapNext\").hidden = !OPEN.includes(l.status) && !$(\"#f_next\").value; };\n  syncVis();\n  $(\"#stGrid\").onclick = e => { const b=e.target.closest(\"button\"); if(!b) return; l.status=b.dataset.s; $(\"#stGrid\").querySelectorAll(\"button\").forEach(x=>x.setAttribute(\"aria-pressed\", x===b)); syncVis(); };\n  $(\"#quick\").onclick = e => { const b=e.target.closest(\"button\"); if(!b) return; const d=new Date();\n    if(b.dataset.q===\"h2\") d.setHours(d.getHours()+2); if(b.dataset.q===\"tom\"){ d.setDate(d.getDate()+1); d.setHours(10,0,0,0); } if(b.dataset.q===\"d3\"){ d.setDate(d.getDate()+3); d.setHours(10,0,0,0); }\n    $(\"#f_next\").value = b.dataset.q===\"clr\" ? \"\" : fmtDT(d).replace(\" \",\"T\"); };\n  $(\"#leadForm\").onsubmit = async e => {\n    e.preventDefault();\n    const msg = $(\"#leadMsg\"), btn = $(\"#saveLead\");\n    const input = { id:l.id, created:fromLocal($(\"#f_created\").value) || l.created, phone:$(\"#f_phone\").value, source:$(\"#f_source\").value, service:$(\"#f_service\").value, status:l.status,\n      nextCall:fromLocal($(\"#f_next\").value), appt:fromLocal($(\"#f_appt\").value), note:$(\"#f_note\").value, comment:$(\"#f_comment\").value };\n    if ($(\"#f_manager\")) input.manager = $(\"#f_manager\").value;\n    if (!normPhone(input.phone)){ msg.className=\"msg err\"; msg.textContent=t(\"phoneBad\"); return; }\n    btn.disabled = true; msg.className=\"msg\"; msg.textContent=t(\"saving\");\n    try { const r = await gs(\"crmSave\", KEY, input); upsert(r.lead); close(); toast(t(\"saved\")); render(); }\n    catch(err){ btn.disabled=false; msg.className=\"msg err\"; msg.textContent = t(\"saveErr\") + \" \" + String((err && err.message) || err); }\n  };\n}\n\n/* ---------- бүгінгі есеп ---------- */\nfunction dayCounts(leads, day){\n  const ls = leads.filter(l => dayKey(l.created)===day);\n  const n = arr => ls.filter(l => arr.includes(l.status)).length;\n  const booked = n(BOOKED);\n  return [ls.length, booked, n([\"noans\"]), n([\"new\",\"work\"]), n([\"refused\"]), ls.length ? booked/ls.length*100 : null];\n}\nfunction viewReport(){\n  const day = S.repDay || todayKey();\n  const groups = S.boss ? S.managers.map(m=>[m, S.leads.filter(l=>l.manager===m)]) : [[S.me, S.leads]];\n  if (S.boss && S.managers.length>1) groups.push([t(\"total\"), S.leads]);\n  const labK = t(\"r_kk\");\n  const cols = groups.map(g=>dayCounts(g[1], day));\n  const cell = (c,i) => i===5 ? (c[5]==null?\"—\":nf1.format(c[5])+\"%\") : nf0.format(c[i]);\n  const head = `<tr><th></th>${groups.map(g=>`<th>${esc(g[0])}</th>`).join(\"\")}</tr>`;\n  const body = REP_RU.map((x,i)=>`<tr><td>${esc(labK[i])}${LANG===\"ru\"?\"\":`<br><span class=\"sub\">${esc(x)}</span>`}</td>${cols.map(c=>`<td>${cell(c,i)}</td>`).join(\"\")}</tr>`).join(\"\");\n  const d = day.split(\"-\");\n  const txt = groups.map((g,gi)=>`Белес CRM — ${d[2]}.${d[1]} — ${g[0]}\\n` + REP_RU.map((x,i)=>`${x}: ${cell(cols[gi],i)}`).join(\"\\n\")).join(\"\\n\\n\");\n  return `<section class=\"panel\"><div class=\"panel-head\"><h2>${esc(t(\"rep\"))}</h2><span class=\"sub\">${esc(t(\"rep_sub\"))}</span></div>\n    <div class=\"bar-tools\"><label class=\"sub\" for=\"repDay\">${esc(t(\"day\"))}</label><input class=\"search\" style=\"flex:0 1 200px\" id=\"repDay\" type=\"date\" value=\"${esc(day)}\"></div>\n    <div class=\"scroll\"><table><thead>${head}</thead><tbody>${body}</tbody></table></div></section>\n    <section class=\"panel\"><div class=\"bar-tools\"><button class=\"btn primary\" id=\"copy\" type=\"button\">${esc(t(\"copy\"))}</button></div><textarea class=\"report\" id=\"repTxt\" readonly>${esc(txt)}</textarea></section>`;\n}\nfunction bindReport(){\n  $(\"#repDay\").onchange = e => { S.repDay = e.target.value || null; render(); };\n  $(\"#copy\").onclick = () => { const ta=$(\"#repTxt\"); const fb=()=>{ ta.focus(); ta.select(); toast(t(\"copyfail\")); };\n    try { navigator.clipboard.writeText(ta.value).then(()=>toast(t(\"copied\")), fb); } catch { fb(); } };\n}\n\n/* ---------- талдау ---------- */\nfunction viewStats(){\n  let ls = scoped();\n  if (S.period){ const from=new Date(); from.setDate(from.getDate()-S.period+1); const fk=fmtDT(from).slice(0,10); ls = ls.filter(l=>dayKey(l.created)>=fk); }\n  const c = arr => ls.filter(l=>arr.includes(l.status)).length;\n  const leads=ls.length, booked=c(BOOKED), came=c([\"came\",\"bought\"]), bought=c([\"bought\"]), open=c(OPEN), overdue=ls.filter(isDue).length;\n  const k = t(\"k\");\n  const tiles = [[k[0],nf0.format(leads)],[k[1],nf0.format(booked)],[k[2],leads?nf1.format(booked/leads*100)+\"%\":\"—\"],[k[3],nf0.format(bought)],[k[4],nf0.format(open)],[k[5],nf0.format(overdue)]];\n  const steps = [[t(\"f\")[0],leads],[t(\"f\")[1],booked],[t(\"f\")[2],came],[t(\"f\")[3],bought]];\n  const fun = steps.map(([lab,v],i)=>{ const prev=i?steps[i-1][1]:null; const w=leads?Math.max(v?2:0,v/leads*100):0;\n    return `<div class=\"fstep\"><span>${esc(lab)}</span><span class=\"v num\">${nf0.format(v)}${i&&prev?`<span class=\"pct\">${nf1.format(v/prev*100)}% ${esc(t(\"ofprev\"))}</span>`:\"\"}</span><div class=\"bar\"><i style=\"width:${w}%\"></i></div></div>`; }).join(\"\");\n  const stageRows = STAGES.map(s=>{ const v=c([s]); return `<div class=\"fstep\"><span>${esc(sn(s))}</span><span class=\"v num\">${nf0.format(v)}${leads?`<span class=\"pct\">${nf1.format(v/leads*100)}%</span>`:\"\"}</span><div class=\"bar\"><i style=\"width:${leads&&v?Math.max(2,v/leads*100):0}%\"></i></div></div>`; }).join(\"\");\n  const group = key => { const m={}; ls.forEach(l=>{ const g=l[key]||\"—\"; (m[g]=m[g]||[]).push(l); });\n    return Object.entries(m).sort((a,b)=>b[1].length-a[1].length).map(([g,arr])=>{ const n=s=>arr.filter(l=>s.includes(l.status)).length; const b=n([\"bought\"]);\n      return `<tr><td>${esc(g)}</td><td>${arr.length}</td><td>${n(BOOKED)}</td><td>${n([\"came\",\"bought\"])}</td><td>${b}</td><td>${arr.length?nf1.format(b/arr.length*100)+\"%\":\"—\"}</td></tr>`; }).join(\"\"); };\n  const th = `<thead><tr><th></th><th>${esc(t(\"leads\"))}</th><th>${esc(t(\"booked\"))}</th><th>${esc(t(\"came\"))}</th><th>${esc(t(\"bought\"))}</th><th>${esc(t(\"conv\"))}</th></tr></thead>`;\n  const per = [[7,t(\"p7\")],[30,t(\"p30\")],[0,t(\"pall\")]].map(([v,lab])=>`<button type=\"button\" class=\"chip\" data-p=\"${v}\" aria-pressed=\"${S.period===v}\">${esc(lab)}</button>`).join(\"\");\n  const mgrSel = S.boss && S.managers.length>1 ? `<select id=\"mgr\" aria-label=\"${esc(t(\"manager\"))}\"><option value=\"\">${esc(t(\"allm\"))}</option>${S.managers.map(m=>`<option ${m===S.mgr?\"selected\":\"\"}>${esc(m)}</option>`).join(\"\")}</select>` : \"\";\n  return `<div class=\"bar-tools\"><div class=\"chips\" id=\"per\">${per}</div>${mgrSel}</div>\n    <section class=\"kpis\">${tiles.map(([a,b])=>`<div class=\"kpi\"><span class=\"label\">${esc(a)}</span><b class=\"num\">${b}</b></div>`).join(\"\")}</section>\n    <section class=\"panel\"><h2>${esc(t(\"fun\"))}</h2><div class=\"funnel\">${fun}</div></section>\n    <section class=\"panel\"><h2>${esc(t(\"stage\"))}</h2><div class=\"funnel\">${stageRows}</div></section>\n    <section class=\"panel\"><h2>${esc(t(\"bySource\"))}</h2><div class=\"scroll\"><table>${th}<tbody>${group(\"source\")||`<tr><td colspan=\"6\">—</td></tr>`}</tbody></table></div></section>\n    ${S.boss && S.managers.length>1 && !S.mgr ? `<section class=\"panel\"><h2>${esc(t(\"byMgr\"))}</h2><div class=\"scroll\"><table>${th}<tbody>${group(\"manager\")}</tbody></table></div></section>` : \"\"}`;\n}\nfunction bindStats(){\n  $(\"#per\").onclick = e => { const b=e.target.closest(\".chip\"); if(!b) return; S.period=+b.dataset.p; render(); };\n  const m=$(\"#mgr\"); if(m) m.onchange = () => { S.mgr=m.value; render(); };\n}\n\n/* ---------- іске қосу ---------- */\nwindow.addEventListener(\"hashchange\", render);\n$(\"#reload\").onclick = load;\ndocument.querySelectorAll(\".lang button\").forEach(b => b.onclick = () => { LANG=b.dataset.lang; try{localStorage.setItem(\"beles_lang\",LANG);}catch{} render(); });\nchrome();\nload();\nsetInterval(() => { const ae=document.activeElement; if (!S.open && !S.busy.size && document.visibilityState===\"visible\" && !(ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName))) load(); }, 120000);\n\n</script>\n</body>\n</html>\n";
