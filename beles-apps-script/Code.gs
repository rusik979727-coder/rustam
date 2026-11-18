/**
 * Белес маркетинг — Google Apps Script қосымшасы.
 * Таблица ешкімге ашылмайды: қосымша иесінің атынан жұмыс істейді,
 * ал әр қызметкер тек өз құпия кілті бар сілтеме арқылы кіреді.
 */

const SHEET_ID = '16d4enqV1Tdbfw_kJbaM0F_0u8z2FgjdsKAuhqAjo32w';
const LINKS_SHEET = 'Сілтемелер';
const ROLES = ['boss', 'target', 'cc', 'rec'];
const ROLE_TITLES = { boss: 'Белес маркетинг', target: 'Белес · Таргет', cc: 'Белес · Колл-орталық', rec: 'Белес · Ресепшн' };
const ROLE_LABELS = { boss: 'Бастық', target: 'Таргетолог', cc: 'Колл-орталық (2-менеджер)', rec: 'Ресепшн' };
const MONTHS = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ', 'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
const KEYMAP = {
  'кол-во лидов': 'leads', 'кол-во новых лидов': 'leads', 'цена за лид': 'cpl', 'общая сумма': 'spend',
  'запись': 'booked', 'недозвон': 'noanswer', 'в работе': 'inwork', 'отказ': 'refused', 'конверсия': 'conv',
  'консультация на сегодня': 'planned', 'пришли': 'came', 'купили': 'bought', 'думает': 'thinking',
  'касса общая': 'cash', 'нал': 'cashN', 'безнал': 'card', 'перевод': 'transfer'
};

/* ---------- веб-қосымша ---------- */

function doGet(e) {
  const key = e && e.parameter ? e.parameter.k : '';
  const role = roleForKey_(key);
  if (!role) {
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui,sans-serif;padding:32px;max-width:480px">' +
      '<h2>Сілтеме жарамсыз</h2><p>Бастықтан жаңа сілтеме сұраңыз.</p>' +
      '<p style="color:#666">Ссылка недействительна. Попросите новую ссылку у руководителя.</p></div>')
      .setTitle('Белес')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  const tpl = HtmlService.createTemplateFromFile('Index');
  tpl.role = role;
  tpl.key = key;
  return tpl.evaluate()
    .setTitle(ROLE_TITLES[role])
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Беттің деректері: тек осы рөлге рұқсат етілген блоктар + жалпы воронка (ақшасыз). */
function getData(key, sheetName) {
  const role = requireRole_(key);
  const ss = ss_();
  const sheets = ss.getSheets().map(function (s) { return s.getName(); }).filter(function (n) { return n !== LINKS_SHEET; });
  const name = sheets.indexOf(sheetName) >= 0 ? sheetName : defaultSheet_(sheets);
  if (!name) throw new Error('Таблицада ай парағы табылмады.');
  const p = parse_(readSheet_(ss.getSheetByName(name)));
  return {
    role: role,
    sheets: sheets,
    sheet: name,
    dates: p.dates,
    nDays: p.nDays,
    blocks: visibleBlocks_(role, p.blocks).map(stripBlock_),
    funnel: funnel_(p)
  };
}

/**
 * Бір күннің бір блогын сақтау.
 * inputs: { "<жол нөмірі>": сан немесе "" }. Есептелетін өрістерді (лид бағасы,
 * конверсия, касса) сервер өзі санайды — клиенттің мәніне сенбейді.
 */
function saveDay(key, sheetName, blockRow, day, inputs) {
  const role = requireRole_(key);
  day = Number(day);
  if (!(day >= 0 && day < 40) || Math.floor(day) !== day) throw new Error('Күн дұрыс емес.');
  if (sheetName === LINKS_SHEET) throw new Error('Бұл параққа жазуға болмайды.');
  inputs = inputs || {};

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sh = ss_().getSheetByName(sheetName);
    if (!sh) throw new Error('Ай парағы табылмады: ' + sheetName);
    const p = parse_(readSheet_(sh));
    const block = visibleBlocks_(role, p.blocks).filter(function (b) { return b.row === Number(blockRow); })[0];
    if (!block) throw new Error('Бұл бөлімге жазуға рұқсат жоқ.');

    const v = {};
    block.metrics.forEach(function (m) {
      if (!Object.prototype.hasOwnProperty.call(inputs, String(m.row))) return;
      const x = inputs[String(m.row)];
      if (x === null || x === '' || x === undefined) { v[m.key] = null; return; }
      const n = Number(x);
      if (!isFinite(n) || n < 0) throw new Error('Сан дұрыс емес: ' + m.label);
      v[m.key] = n;
    });
    const c = computed_(block, v);

    const r0 = block.metrics[0].row;
    const r1 = block.metrics[block.metrics.length - 1].row;
    const col = day + 2; // A = жол атауы, B = 1-күн
    const range = sh.getRange(r0, col, r1 - r0 + 1, 1);
    const raw = range.getValues();
    const out = [];
    for (let r = r0; r <= r1; r++) {
      const m = block.metrics.filter(function (x) { return x.row === r; })[0];
      let val;
      if (m && Object.prototype.hasOwnProperty.call(c, m.key)) val = c[m.key];
      else if (m && Object.prototype.hasOwnProperty.call(v, m.key)) val = v[m.key];
      else { out.push([raw[r - r0][0]]); continue; }
      out.push([val === null ? '' : Math.round(val * 100) / 100]);
    }
    range.setValues(out);
    SpreadsheetApp.flush();
    return { ok: true, sheet: sheetName, row: r0, col: col };
  } finally {
    lock.releaseLock();
  }
}

/* ---------- сілтемелер (тек таблица иесі үшін) ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Белес')
    .addItem('Сілтемелерді көрсету / жасау', 'createLinks')
    .addSeparator()
    .addItem('Таргет сілтемесін ауыстыру', 'resetTarget')
    .addItem('Колл-орталық сілтемесін ауыстыру', 'resetCc')
    .addItem('Ресепшн сілтемесін ауыстыру', 'resetRec')
    .addItem('Бастық сілтемесін ауыстыру', 'resetBoss')
    .addToUi();
}

function createLinks() {
  const keys = keys_();
  let changed = false;
  ROLES.forEach(function (r) { if (!keys[r]) { keys[r] = newKey_(); changed = true; } });
  if (changed) saveKeys_(keys);
  writeLinks_(keys);
}
function resetTarget() { resetRole_('target'); }
function resetCc() { resetRole_('cc'); }
function resetRec() { resetRole_('rec'); }
function resetBoss() { resetRole_('boss'); }

function resetRole_(role) {
  const keys = keys_();
  keys[role] = newKey_();
  saveKeys_(keys);
  writeLinks_(keys);
  notify_(ROLE_LABELS[role] + ': жаңа сілтеме жасалды. Ескі сілтеме енді ашылмайды.');
}

function writeLinks_(keys) {
  const url = ScriptApp.getService().getUrl();
  if (!url) {
    notify_('Алдымен қосымшаны жариялаңыз: Apps Script → «Развернуть» → «Новое развертывание» → «Веб-приложение».');
    return;
  }
  const ss = ss_();
  let sh = ss.getSheetByName(LINKS_SHEET);
  if (!sh) sh = ss.insertSheet(LINKS_SHEET);
  sh.clear();
  const rows = [['Кімге', 'Сілтеме', 'Ескерту']];
  ROLES.forEach(function (r) {
    rows.push([ROLE_LABELS[r], url + '?k=' + keys[r], r === 'boss' ? 'Тек өзіңізге. Бәрін көреді.' : 'Тек осы адамға беріңіз.']);
  });
  sh.getRange(1, 1, rows.length, 3).setValues(rows);
  sh.getRange(1, 1, 1, 3).setFontWeight('bold');
  sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 560); sh.setColumnWidth(3, 260);
  ss.setActiveSheet(sh);
  notify_('Сілтемелер «' + LINKS_SHEET + '» парағында. Бұл парақты ешкіммен бөліспеңіз.');
}

/* ---------- көмекші функциялар ---------- */

function ss_() { return SpreadsheetApp.openById(SHEET_ID); }
function keys_() { return JSON.parse(PropertiesService.getScriptProperties().getProperty('KEYS') || '{}'); }
function saveKeys_(k) { PropertiesService.getScriptProperties().setProperty('KEYS', JSON.stringify(k)); }
function newKey_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').slice(0, 24); }
function notify_(msg) { try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); } }

function roleForKey_(k) {
  if (!k) return null;
  const keys = keys_();
  for (let i = 0; i < ROLES.length; i++) if (keys[ROLES[i]] && keys[ROLES[i]] === String(k)) return ROLES[i];
  return null;
}
function requireRole_(k) {
  const r = roleForKey_(k);
  if (!r) throw new Error('Сілтеме жарамсыз. Бастықтан жаңа сілтеме сұраңыз.');
  return r;
}

function defaultSheet_(sheets) {
  const cur = MONTHS[new Date().getMonth()];
  for (let i = 0; i < sheets.length; i++) if (String(sheets[i]).trim().toUpperCase() === cur) return sheets[i];
  return sheets[sheets.length - 1];
}

function readSheet_(sh) {
  const rows = Math.max(1, Math.min(sh.getLastRow(), 300));
  const cols = Math.max(2, Math.min(sh.getLastColumn(), 40));
  return sh.getRange(1, 1, rows, cols).getDisplayValues();
}

function num_(x) {
  if (x === null || x === undefined) return null;
  let s = String(x).trim();
  if (!s) return null;
  s = s.replace(/[^\d,.\-]/g, '');
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const v = parseFloat(s);
  return isFinite(v) ? v : null;
}

/** Бос жолдармен бөлінген блоктар: бірінші жол — тақырып, қалғандары — көрсеткіштер. */
function parse_(values) {
  const blocks = [];
  let cur = null;
  values.forEach(function (row, i) {
    const empty = !row.some(function (c) { return String(c).trim() !== ''; });
    if (empty) { cur = null; return; }
    const label = String(row[0]).trim();
    if (!cur) { cur = { title: label, row: i + 1, header: row, metrics: [], m: {} }; blocks.push(cur); return; }
    const key = KEYMAP[label.toLowerCase()] || ('x_' + label.toLowerCase());
    const met = { label: label, key: key, row: i + 1, cells: row.slice(1) };
    cur.metrics.push(met);
    if (!cur.m[key]) cur.m[key] = met;
  });
  const seen = {};
  let lastCc = '';
  blocks.forEach(function (b) {
    const t = b.title.toLowerCase();
    b.type = t.indexOf('таргет') === 0 ? 'target' : t.indexOf('колл') === 0 ? 'cc' : t.indexOf('ресепш') === 0 ? 'rec' : 'other';
    b.name = b.title;
    if (b.type === 'cc') lastCc = b.title.replace(/колл-центр/i, '').trim();
    if (seen[b.title]) b.name = b.title + (lastCc ? ' · ' + lastCc : ' ' + (seen[b.title] + 1));
    seen[b.title] = (seen[b.title] || 0) + 1;
  });
  const hdr = blocks.filter(function (b) { return b.header.slice(1).some(function (c) { return /\d/.test(String(c)); }); })[0];
  const dates = hdr ? hdr.header.slice(1).map(function (c) { return String(c).trim().replace(/[/,]/, '.'); }) : [];
  while (dates.length && !dates[dates.length - 1]) dates.pop();
  const nDays = Math.max(31, dates.length);
  while (dates.length < nDays) dates.push(String(dates.length + 1));
  return { blocks: blocks, dates: dates, nDays: nDays };
}

/** Рөлдің көретін блоктары. Бірінші колл-центр блогы — бастықтікі, 2-менеджер оны көрмейді. */
function visibleBlocks_(role, blocks) {
  if (role === 'boss') return blocks;
  const firstCc = blocks.filter(function (b) { return b.type === 'cc'; })[0];
  return blocks.filter(function (b) {
    if (b.type !== role) return false;
    if (role === 'cc' && b === firstCc) return false;
    return true;
  });
}

function stripBlock_(b) {
  return { title: b.title, row: b.row, type: b.type, name: b.name, metrics: b.metrics };
}

function get_(b, key, d) { return b.m[key] ? num_(b.m[key].cells[d]) : null; }

/** Барлығына ортақ воронка: тек сандар, ақша жоқ. */
function funnel_(p) {
  const out = { tLeads: [], ccLeads: [], booked: [], came: [], bought: [] };
  const sum = function (type, key, d) {
    let s = null;
    p.blocks.forEach(function (b) { if (b.type !== type) return; const v = get_(b, key, d); if (v !== null) s = (s || 0) + v; });
    return s;
  };
  for (let d = 0; d < p.nDays; d++) {
    out.tLeads.push(sum('target', 'leads', d));
    out.ccLeads.push(sum('cc', 'leads', d));
    out.booked.push(sum('cc', 'booked', d));
    out.came.push(sum('rec', 'came', d));
    out.bought.push(sum('rec', 'bought', d));
  }
  return out;
}

function computed_(b, v) {
  const out = {};
  if (b.m.cpl && b.m.spend) out.cpl = v.spend != null && v.leads ? v.spend / v.leads : null;
  if (b.m.conv && b.m.booked) out.conv = v.leads && v.booked != null ? v.booked / v.leads * 100 : null;
  const parts = ['cashN', 'card', 'transfer'];
  if (b.m.cash && parts.some(function (k) { return v[k] != null; })) {
    out.cash = parts.reduce(function (a, k) { return a + (v[k] || 0); }, 0);
  }
  return out;
}
