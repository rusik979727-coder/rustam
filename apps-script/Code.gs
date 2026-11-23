/**
 * Белес маркетинг — Google Таблицаға тікелей қосылған веб-бағдарлама.
 *
 * Рөлдер:
 *   target     — таргетолог (лид саны, жұмсалған сома)
 *   callcenter — колл-центр (таргет лидтері автоматты түрде көрінеді)
 *   reception  — ресепшн (консультация, келді, сатып алды, касса)
 *   boss       — бастық (барлық блоктар, жалпы есеп, сілтемелер)
 *
 * Әр маманның жеке сілтемесі: <веб-қосымша URL>?k=<кілт>
 * Кілттер «Доступ» парағында сақталады.
 */

// «Маркетинг приложение» кестесі
var SPREADSHEET_ID = '1nVmHYM9AfG45Q_L5NDz8CFHa8dogqU3CB0hwvbZGJgk';
// Бағдарлама осы күннен бастап жұмыс істейді (мамандар бұрынғы күндерге жаза алмайды)
var START_DATE = '2026-11-23';

var ACCESS_SHEET = 'Доступ';
var LOG_SHEET = 'Журнал';
var MONTHS = ['ЯНВАРЬ', 'ФЕВРАЛЬ', 'МАРТ', 'АПРЕЛЬ', 'МАЙ', 'ИЮНЬ', 'ИЮЛЬ',
  'АВГУСТ', 'СЕНТЯБРЬ', 'ОКТЯБРЬ', 'НОЯБРЬ', 'ДЕКАБРЬ'];
var DAY_COLUMNS = 31; // B..AF — 1-күн B бағанында

/** Әр рөлдің өрістері. label — кестедегі А бағанындағы атау (орысша). */
var ROLES = {
  target: {
    title: 'Таргет',
    fields: [
      { key: 'leads', labels: ['кол-во лидов', 'количество лидов'], kz: 'Лид саны', ru: 'Кол-во лидов', type: 'int' },
      { key: 'spend', labels: ['общая сумма'], kz: 'Жұмсалған сома ($)', ru: 'Потрачено ($)', type: 'money' },
      { key: 'cpl', labels: ['цена за лид'], kz: 'Бір лид бағасы ($)', ru: 'Цена за лид ($)', type: 'calc',
        formula: function (c, r) { return r.spend && r.leads ? '=IFERROR(' + c + r.spend + '/' + c + r.leads + ')' : null; } }
    ]
  },
  callcenter: {
    title: 'Колл-центр',
    fields: [
      { key: 'leads', labels: ['кол-во новых лидов', 'кол-во лидов'], kz: 'Жаңа лидтер', ru: 'Новые лиды', type: 'int' },
      { key: 'booked', labels: ['запись'], kz: 'Жазылды (запись)', ru: 'Запись', type: 'int' },
      { key: 'noanswer', labels: ['недозвон'], kz: 'Көтермеді (недозвон)', ru: 'Недозвон', type: 'int' },
      { key: 'inwork', labels: ['в работе'], kz: 'Жұмыста', ru: 'В работе', type: 'int' },
      { key: 'refused', labels: ['отказ'], kz: 'Бас тартты (отказ)', ru: 'Отказ', type: 'int' },
      { key: 'conv', labels: ['конверсия'], kz: 'Конверсия (%)', ru: 'Конверсия (%)', type: 'calc',
        formula: function (c, r) { return r.booked && r.leads ? '=IFERROR(ROUND(1000*' + c + r.booked + '/' + c + r.leads + ')/10)' : null; } }
    ]
  },
  reception: {
    title: 'Ресепшн',
    fields: [
      { key: 'consult', labels: ['консультация на сегодня', 'консультация'], kz: 'Бүгінгі консультациялар', ru: 'Консультации на сегодня', type: 'int' },
      { key: 'came', labels: ['пришли'], kz: 'Келді', ru: 'Пришли', type: 'int' },
      { key: 'bought', labels: ['купили'], kz: 'Сатып алды', ru: 'Купили', type: 'int' },
      { key: 'thinking', labels: ['думает'], kz: 'Ойланып жүр', ru: 'Думают', type: 'int' },
      { key: 'refused', labels: ['отказ'], kz: 'Бас тартты', ru: 'Отказ', type: 'int' },
      { key: 'total', labels: ['касса общая'], kz: 'Жалпы касса', ru: 'Касса общая', type: 'calc',
        formula: function (c, r) {
          var parts = ['cash', 'card', 'transfer'].filter(function (k) { return r[k]; })
            .map(function (k) { return c + r[k]; });
          return parts.length ? '=' + parts.join('+') : null;
        } },
      { key: 'cash', labels: ['нал', 'наличные'], kz: 'Қолма-қол (нал)', ru: 'Наличные', type: 'money' },
      { key: 'card', labels: ['безнал'], kz: 'Карта (безнал)', ru: 'Безнал', type: 'money' },
      { key: 'transfer', labels: ['перевод'], kz: 'Аударым (перевод)', ru: 'Перевод', type: 'money' }
    ]
  }
};

/* ============================ Веб-қосымша ============================ */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Белес маркетинг')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Бастапқы ақпарат: кім кірді, қандай блоктар бар. */
function apiInit(key) {
  var user = auth_(key);
  var now = new Date();
  var tz = Session.getScriptTimeZone();
  var res = {
    user: { name: user.name, role: user.role, block: user.block },
    today: Utilities.formatDate(now, tz, 'yyyy-MM-dd'),
    startDate: START_DATE,
    roles: rolesForClient_()
  };
  if (user.role === 'boss') {
    var sheet = getMonthSheet_(now.getFullYear(), now.getMonth() + 1, false) || anyMonthSheet_();
    res.blocks = sheet ? detectBlocks_(sheet).map(function (b) { return { id: b.id, name: b.name, role: b.role }; }) : [];
    res.sheetUrl = ss_().getUrl();
  }
  return res;
}

/** Бір күннің мәндері. */
function apiGetDay(key, blockId, dateStr) {
  var user = auth_(key);
  blockId = allowedBlock_(user, blockId);
  var d = parseDate_(dateStr);
  var sheet = getMonthSheet_(d.y, d.m, false);
  var result = { blockId: blockId, date: dateStr, values: {}, exists: !!sheet };
  var block = sheet ? findBlock_(sheet, blockId) : null;
  var role = block ? block.role : roleOfBlockName_(blockId);
  result.role = role;
  if (block) {
    var col = d.d + 1;
    var vals = sheet.getRange(block.firstRow, col, block.lastRow - block.firstRow + 1, 1).getValues();
    Object.keys(block.rows).forEach(function (k) {
      result.values[k] = cleanVal_(vals[block.rows[k] - block.firstRow][0]);
    });
    result.available = Object.keys(block.rows);
  } else {
    result.available = ROLES[role] ? ROLES[role].fields.map(function (f) { return f.key; }) : [];
  }
  // Таргет ↔ Колл-центр байланысы: колл-центрге сол күнгі таргет лидтері
  if (role === 'callcenter' && sheet) {
    var tb = findBlock_(sheet, linkedTargetFor_(user, blockId, sheet));
    if (tb && tb.rows.leads) {
      result.targetLeads = cleanVal_(sheet.getRange(tb.rows.leads, d.d + 1).getValue());
      if (tb.rows.spend) result.targetSpend = cleanVal_(sheet.getRange(tb.rows.spend, d.d + 1).getValue());
    }
  }
  return result;
}

/** Бір күннің мәндерін сақтау. */
function apiSaveDay(key, blockId, dateStr, values) {
  var user = auth_(key);
  blockId = allowedBlock_(user, blockId);
  var d = parseDate_(dateStr);
  if (user.role !== 'boss' && dateStr < START_DATE) throw new Error('Бағдарлама ' + START_DATE.split('-').reverse().join('.') + ' күнінен басталады / Программа работает с ' + START_DATE.split('-').reverse().join('.'));
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sheet = getMonthSheet_(d.y, d.m, true);
    var block = findBlock_(sheet, blockId);
    if (!block) throw new Error('Кестеде «' + blockId + '» блогы табылмады / Блок «' + blockId + '» не найден');
    var def = ROLES[block.role];
    var col = d.d + 1;
    var colL = colLetter_(col);
    var changes = [];
    def.fields.forEach(function (f) {
      var row = block.rows[f.key];
      if (!row) return;
      var cell = sheet.getRange(row, col);
      if (f.type === 'calc') {
        var fm = f.formula(colL, block.rows);
        if (fm) cell.setFormula(fm);
        return;
      }
      if (!(f.key in values)) return;
      var raw = values[f.key];
      var nv = (raw === '' || raw === null || raw === undefined) ? '' : Number(String(raw).replace(',', '.'));
      if (nv !== '' && (isNaN(nv) || nv < 0)) throw new Error('«' + f.kz + '» өрісінде қате сан / Неверное число: ' + f.ru);
      if (f.type === 'int' && nv !== '') nv = Math.round(nv);
      var old = cleanVal_(cell.getValue());
      if (String(old) !== String(nv)) {
        cell.setValue(nv);
        changes.push(f.kz + ': ' + (old === '' ? '—' : old) + ' → ' + (nv === '' ? '—' : nv));
      }
    });
    SpreadsheetApp.flush();
    if (changes.length) log_(user, blockId, dateStr, changes.join('; '));
  } finally {
    lock.releaseLock();
  }
  return apiGetDay(key, blockId, dateStr);
}

/** Бір блоктың айлық кестесі (маманның өзі үшін). */
function apiGetMonthBlock(key, blockId, ym) {
  var user = auth_(key);
  blockId = allowedBlock_(user, blockId);
  var p = ym.split('-');
  var y = +p[0], m = +p[1];
  var sheet = getMonthSheet_(y, m, false);
  var days = daysIn_(y, m);
  var out = { days: days, rows: {}, role: roleOfBlockName_(blockId) };
  if (!sheet) return out;
  var block = findBlock_(sheet, blockId);
  if (!block) return out;
  out.role = block.role;
  var data = sheet.getRange(block.firstRow, 2, block.lastRow - block.firstRow + 1, DAY_COLUMNS).getValues();
  Object.keys(block.rows).forEach(function (k) {
    out.rows[k] = data[block.rows[k] - block.firstRow].slice(0, days).map(cleanVal_);
  });
  return out;
}

/** Бастыққа: айдың жалпы есебі (барлық блоктар). */
function apiGetSummary(key, ym) {
  var user = auth_(key);
  if (user.role !== 'boss') throw new Error('Тек бастыққа рұқсат / Только для руководителя');
  var p = ym.split('-');
  var y = +p[0], m = +p[1];
  var sheet = getMonthSheet_(y, m, false);
  var days = daysIn_(y, m);
  var out = { days: days, blocks: [], sheetName: sheet ? sheet.getName() : null };
  if (!sheet) return out;
  var blocks = detectBlocks_(sheet);
  var lastRow = Math.max.apply(null, blocks.map(function (b) { return b.lastRow; }).concat([1]));
  var data = sheet.getRange(1, 1, lastRow, DAY_COLUMNS + 1).getValues();
  blocks.forEach(function (b) {
    var rows = {};
    Object.keys(b.rows).forEach(function (k) {
      rows[k] = data[b.rows[k] - 1].slice(1, days + 1).map(cleanVal_);
    });
    out.blocks.push({ id: b.id, name: b.name, role: b.role, rows: rows });
  });
  return out;
}

/** Бастыққа: барлық сілтемелер. */
function apiGetLinks(key) {
  var user = auth_(key);
  if (user.role !== 'boss') throw new Error('Тек бастыққа рұқсат / Только для руководителя');
  var url = ScriptApp.getService().getUrl();
  return loadUsers_().map(function (u) {
    var link = /^https?:\/\//.test(u.link) ? u.link : url + '?k=' + encodeURIComponent(u.key);
    return { name: u.name, role: u.role, block: u.block, url: link };
  });
}

/** Бастыққа: соңғы өзгерістер журналы. */
function apiGetLog(key) {
  var user = auth_(key);
  if (user.role !== 'boss') throw new Error('Тек бастыққа рұқсат / Только для руководителя');
  var sh = ss_().getSheetByName(LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var n = Math.min(50, sh.getLastRow() - 1);
  var tz = Session.getScriptTimeZone();
  return sh.getRange(sh.getLastRow() - n + 1, 1, n, 5).getValues().reverse().map(function (r) {
    return {
      time: r[0] instanceof Date ? Utilities.formatDate(r[0], tz, 'dd.MM HH:mm') : String(r[0]),
      name: r[1], block: r[2], date: r[3] instanceof Date ? Utilities.formatDate(r[3], tz, 'dd.MM.yyyy') : String(r[3]),
      changes: r[4]
    };
  });
}

/* ============================ Кесте мәзірі ============================ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Белес бағдарлама')
    .addItem('1. Орнату («Доступ» парағын жасау)', 'setup')
    .addItem('2. Сілтемелерді жаңарту', 'refreshLinks')
    .addToUi();
}

/** «Доступ» парағын жасайды, әр блокқа жеке кілт береді. */
function setup() {
  var ss = ss_();
  var sh = ss.getSheetByName(ACCESS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ACCESS_SHEET);
    sh.getRange(1, 1, 1, 6).setValues([['Аты-жөні', 'Рөлі', 'Кілт', 'Блок (кестедегі атауы)', 'Байланысқан таргет блогы', 'Сілтеме']])
      .setFontWeight('bold').setBackground('#e8eaf6');
    var rows = [['Бастық', 'boss', newKey_(), '', '', '']];
    var src = anyMonthSheet_();
    if (src) {
      detectBlocks_(src).forEach(function (b) {
        rows.push([b.name, b.role, newKey_(), b.id, b.role === 'callcenter' ? firstTargetId_(src) : '', '']);
      });
    }
    sh.getRange(2, 1, rows.length, 6).setValues(rows);
    sh.getRange(2, 2, 200, 1).setDataValidation(SpreadsheetApp.newDataValidation()
      .requireValueInList(['boss', 'target', 'callcenter', 'reception'], true).build());
    sh.setColumnWidths(1, 5, 180);
    sh.setColumnWidth(6, 520);
    sh.setFrozenRows(1);
  }
  refreshLinks();
}

/** «Сілтеме» бағанын толтырады (веб-қосымша орналастырылғаннан кейін). */
function refreshLinks() {
  var sh = ss_().getSheetByName(ACCESS_SHEET);
  if (!sh) return setup();
  var url = ScriptApp.getService().getUrl();
  // Тест-сілтеме (/dev) мамандарға ашылмайды — оны жазбаймыз
  if (url && /\/dev$/.test(url)) {
    SpreadsheetApp.getUi().alert('Сілтемені Deploy терезесінен (/exec) көшіріп, «Сілтеме» бағанына қолмен қойыңыз.');
    return;
  }
  var last = sh.getLastRow();
  if (last < 2) return;
  var keys = sh.getRange(2, 3, last - 1, 1).getValues();
  sh.getRange(2, 6, last - 1, 1).setValues(keys.map(function (k) {
    if (!k[0]) return [''];
    return [url ? url + '?k=' + encodeURIComponent(String(k[0]).trim()) : 'Алдымен Deploy → Web app жасаңыз'];
  }));
}

/* ============================ Көмекші функциялар ============================ */

function ss_() {
  if (!ss_.cache) {
    var active = null;
    try { active = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) {}
    ss_.cache = (active && active.getId() === SPREADSHEET_ID) ? active : SpreadsheetApp.openById(SPREADSHEET_ID);
  }
  return ss_.cache;
}

function auth_(key) {
  key = String(key || '').trim();
  if (!key) throw new Error('Сілтеме қате: кілт жоқ / Неверная ссылка: нет ключа');
  var users = loadUsers_();
  for (var i = 0; i < users.length; i++) if (users[i].key === key) return users[i];
  throw new Error('Рұқсат жоқ: сілтеме жарамсыз / Нет доступа: ссылка недействительна');
}

function loadUsers_() {
  var sh = ss_().getSheetByName(ACCESS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues()
    .filter(function (r) { return String(r[2]).trim(); })
    .map(function (r) {
      return {
        name: String(r[0]).trim(), role: normRole_(r[1]), key: String(r[2]).trim(),
        block: String(r[3]).trim(), linkedTarget: String(r[4]).trim(), link: String(r[5]).trim()
      };
    });
}

function normRole_(r) {
  var s = norm_(r);
  if (/^(boss|бастық|бастык|руковод|директор|админ)/.test(s)) return 'boss';
  if (/^(target|таргет)/.test(s)) return 'target';
  if (/^(callcenter|call|колл|кол)/.test(s)) return 'callcenter';
  if (/^(reception|ресепш|ресеп)/.test(s)) return 'reception';
  return s;
}

/** Маман тек өз блогына, бастық — барлығына. */
function allowedBlock_(user, blockId) {
  if (user.role === 'boss') {
    if (!blockId) throw new Error('Блок таңдалмаған / Блок не выбран');
    return blockId;
  }
  if (!user.block) throw new Error('«Доступ» парағында блок көрсетілмеген / В листе «Доступ» не указан блок');
  return user.block;
}

function linkedTargetFor_(user, blockId, sheet) {
  if (user.role === 'callcenter' && user.linkedTarget) return user.linkedTarget;
  var users = loadUsers_();
  for (var i = 0; i < users.length; i++) {
    if (users[i].block === blockId && users[i].linkedTarget) return users[i].linkedTarget;
  }
  return firstTargetId_(sheet);
}

function firstTargetId_(sheet) {
  var b = detectBlocks_(sheet).filter(function (x) { return x.role === 'target'; })[0];
  return b ? b.id : 'Таргет';
}

function norm_(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function roleOfBlockName_(name) {
  var s = norm_(String(name).replace(/#\d+$/, ''));
  if (/^таргет/.test(s)) return 'target';
  if (/^(колл|кол)[- ]?центр/.test(s) || /^call/.test(s)) return 'callcenter';
  if (/^ресепш/.test(s)) return 'reception';
  return null;
}

/**
 * Парақтағы блоктарды табады: А бағанында «Таргет», «Колл-центр…», «Ресепшн…»
 * деп басталатын жол — блок басы, астындағы бос емес жолдар — өрістер.
 * Атауы қайталанса, id-ге #2, #3 қосылады (мыс. «Ресепшн#2»).
 */
function detectBlocks_(sheet) {
  var last = sheet.getLastRow();
  if (last < 1) return [];
  var colA = sheet.getRange(1, 1, last, 1).getValues().map(function (r) { return r[0]; });
  var blocks = [];
  var seen = {};
  for (var i = 0; i < colA.length; i++) {
    var role = roleOfBlockName_(colA[i]);
    if (!role || !String(colA[i]).trim()) continue;
    var name = String(colA[i]).trim();
    var nk = norm_(name);
    seen[nk] = (seen[nk] || 0) + 1;
    var id = seen[nk] > 1 ? name + '#' + seen[nk] : name;
    var rows = {};
    var j = i + 1;
    for (; j < colA.length; j++) {
      var lbl = norm_(colA[j]);
      if (!lbl || roleOfBlockName_(colA[j])) break;
      ROLES[role].fields.forEach(function (f) {
        if (!rows[f.key] && f.labels.indexOf(lbl) !== -1) rows[f.key] = j + 1;
      });
    }
    blocks.push({ id: id, name: name, role: role, headerRow: i + 1, firstRow: i + 1, lastRow: Math.max(j, i + 1), rows: rows });
    i = j - 1;
  }
  return blocks;
}

function findBlock_(sheet, blockId) {
  var blocks = detectBlocks_(sheet);
  var want = norm_(blockId);
  for (var i = 0; i < blocks.length; i++) if (norm_(blocks[i].id) === want) return blocks[i];
  return null;
}

/** Айдың парағын табады (мыс. «НОЯБРЬ»), керек болса жасайды. */
function getMonthSheet_(y, m, create) {
  var ss = ss_();
  var base = MONTHS[m - 1];
  var withYear = ss.getSheetByName(base + ' ' + y);
  if (withYear) return withYear;
  var plain = ss.getSheetByName(base);
  if (plain && sheetYearOk_(plain, y)) return plain;
  if (!create) return null;
  return createMonthSheet_(y, m, plain ? base + ' ' + y : base);
}

function sheetYearOk_(sheet, y) {
  var blocks = detectBlocks_(sheet);
  for (var i = 0; i < blocks.length; i++) {
    var v = sheet.getRange(blocks[i].headerRow, 2).getValue();
    if (v instanceof Date) return v.getFullYear() === y;
  }
  return true;
}

function anyMonthSheet_() {
  var sheets = ss_().getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var n = sheets[i].getName().split(' ')[0].toUpperCase();
    if (MONTHS.indexOf(n) !== -1 && detectBlocks_(sheets[i]).length) return sheets[i];
  }
  return null;
}

/** Жаңа айдың парағын бұрынғы айдың үлгісімен жасайды. */
function createMonthSheet_(y, m, name) {
  var ss = ss_();
  var tpl = anyMonthSheet_();
  if (!tpl) throw new Error('Үлгі ретінде ай парағы табылмады');
  var sh = tpl.copyTo(ss).setName(name);
  try { ss.setActiveSheet(sh); ss.moveActiveSheet(1); } catch (e) {}
  var blocks = detectBlocks_(sh);
  blocks.forEach(function (b) {
    var n = b.lastRow - b.firstRow;
    if (n > 0) sh.getRange(b.firstRow + 1, 2, n, DAY_COLUMNS).clearContent();
    var hdr = sh.getRange(b.headerRow, 2, 1, DAY_COLUMNS);
    var sample = hdr.getValues()[0];
    var isText = sample.some(function (v) { return typeof v === 'string' && v; });
    var sep = isText && String(sample.filter(String)[0]).indexOf('/') !== -1 ? '/' : '.';
    var vals = [];
    for (var i = 0; i < DAY_COLUMNS; i++) {
      var dt = new Date(y, m - 1, 1 + i);
      vals.push(isText ? Utilities.formatDate(dt, Session.getScriptTimeZone(), 'dd' + sep + 'MM') : dt);
    }
    if (isText) hdr.setNumberFormat('@');
    else if (!sample.some(function (v) { return v instanceof Date; })) hdr.setNumberFormat('dd.mm');
    hdr.setValues([vals]);
    // Есептелетін өрістердің формулалары
    ROLES[b.role].fields.forEach(function (f) {
      if (f.type !== 'calc' || !b.rows[f.key]) return;
      var fs = [];
      for (var c = 2; c < 2 + DAY_COLUMNS; c++) fs.push(f.formula(colLetter_(c), b.rows) || '');
      sh.getRange(b.rows[f.key], 2, 1, DAY_COLUMNS).setFormulas([fs]);
    });
  });
  return sh;
}

function log_(user, blockId, dateStr, text) {
  var ss = ss_();
  var sh = ss.getSheetByName(LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(LOG_SHEET);
    sh.appendRow(['Уақыты', 'Кім', 'Блок', 'Күн', 'Өзгерістер']);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  var d = parseDate_(dateStr);
  sh.appendRow([new Date(), user.name, blockId, new Date(d.y, d.m - 1, d.d), text]);
}

function rolesForClient_() {
  var out = {};
  Object.keys(ROLES).forEach(function (r) {
    out[r] = { title: ROLES[r].title, fields: ROLES[r].fields.map(function (f) { return { key: f.key, kz: f.kz, ru: f.ru, type: f.type, label: f.labels[0] }; }) };
  });
  return out;
}

function parseDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) throw new Error('Күні қате / Неверная дата');
  var y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > daysIn_(y, mo)) throw new Error('Күні қате / Неверная дата');
  return { y: y, m: mo, d: d };
}

function daysIn_(y, m) { return new Date(y, m, 0).getDate(); }

function cleanVal_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  if (v instanceof Date) return '';
  var n = Number(String(v).replace(/[$\s₸]/g, '').replace(',', '.'));
  return isNaN(n) ? '' : n;
}

function colLetter_(c) {
  var s = '';
  while (c > 0) { var r = (c - 1) % 26; s = String.fromCharCode(65 + r) + s; c = Math.floor((c - 1) / 26); }
  return s;
}

function newKey_() {
  return Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}
