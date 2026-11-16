// Google Apps Script-тің тест үшін жасалған шағын жалған нұсқасы (SpreadsheetApp, LockService т.б.).
// .gs файлдары vm контекстінде жүктеледі — Apps Script-тегідей ортақ global scope-пен.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GS_DIR = path.join(__dirname, '..', 'apps-script');

function colLetterToIndex(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

class FakeRange {
  constructor(sheet, row, col, nr, nc) {
    Object.assign(this, { sheet, row, col, nr, nc });
  }
  getRow() { return this.row; }
  getLastRow() { return this.row + this.nr - 1; }
  getColumn() { return this.col; }
  _each(fn) {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const line = [];
      for (let c = 0; c < this.nc; c++) line.push(fn(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValues() { return this._each((r, c) => this.sheet._get(r, c)); }
  getDisplayValues() { return this._each((r, c) => String(this.sheet._get(r, c))); }
  getValue() { return this.sheet._get(this.row, this.col); }
  setValue(v) { this.sheet._set(this.row, this.col, v); return this; }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues: өлшем сәйкес емес');
    vals.forEach((line, r) => line.forEach((v, c) => this.sheet._set(this.row + r, this.col + c, v)));
    return this;
  }
  clearContent() { this._each((r, c) => this.sheet._set(r, c, '')); return this; }
  getMergedRanges() {
    return this.sheet.merges
      .filter((m) => m.col >= this.col && m.col <= this.col + this.nc - 1 &&
        m.end >= this.row && m.start <= this.getLastRow())
      .map((m) => new FakeRange(this.sheet, m.start, m.col, m.end - m.start + 1, 1));
  }
  getDataValidation() {
    const list = this.sheet.validation[this.col];
    if (!list || this.row < 3) return null;
    return { getCriteriaType: () => 'VALUE_IN_LIST', getCriteriaValues: () => [list.slice(), true] };
  }
}

class FakeSheet {
  constructor(name, data) {
    this.name = name;
    this.cells = (data.values || []).map((r) => r.slice());
    this.merges = (data.merges || []).map((m) => ({ ...m }));
    this.validation = data.validation || {};
  }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMaxRows() { return Math.max(this.cells.length, 1000); }
  getLastRow() {
    for (let r = this.cells.length; r > 0; r--) {
      if ((this.cells[r - 1] || []).some((v) => v !== '' && v != null)) return r;
    }
    return 0;
  }
  _get(r, c) {
    const v = (this.cells[r - 1] || [])[c - 1];
    return v == null ? '' : v;
  }
  _set(r, c, v) {
    const list = this.validation[c];
    if (typeof v === 'string' && v.startsWith("'")) v = v.slice(1);
    else if (typeof v === 'string' && /^[=+]/.test(v)) v = '#ERROR!';
    if (list && r >= 3 && v !== '' && !list.includes(v)) {
      throw new Error('The data you entered violates the data validation rules');
    }
    while (this.cells.length < r) this.cells.push([]);
    const line = this.cells[r - 1];
    while (line.length < c) line.push('');
    line[c - 1] = v;
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+)$/.exec(a);
      return new FakeRange(this, Number(m[2]), colLetterToIndex(m[1]), 1, 1);
    }
    return new FakeRange(this, a, b, c || 1, d || 1);
  }
  _clone(name) {
    return new FakeSheet(name, {
      values: JSON.parse(JSON.stringify(this.cells)),
      merges: this.merges,
      validation: this.validation
    });
  }
}

class FakeSpreadsheet {
  constructor(sheets) { this.sheets = sheets; this.name = 'БЕЛЕС ГРАФИК (тест)'; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/test'; }
  getSpreadsheetTimeZone() { return 'Asia/Almaty'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find((s) => s.getName() === n) || null; }
  insertSheet(name, index, opts) {
    if (this.getSheetByName(name)) throw new Error('Sheet exists: ' + name);
    const sh = opts && opts.template ? opts.template._clone(name) : new FakeSheet(name, {});
    this.sheets.splice(index, 0, sh);
    return sh;
  }
}

function formatDate(date, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).reduce((o, p) => ((o[p.type] = p.value), o), {});
  return fmt.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day);
}

/** .gs файлдарын жүктеп, жалған таблицамен байланыстырады. */
function loadApp(spreadsheet, opts = {}) {
  const ctx = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    LockService: { getScriptLock: () => ({ tryLock: () => opts.lockFails !== true, releaseLock() {} }) },
    Session: { getScriptTimeZone: () => 'Asia/Almaty' },
    Utilities: { formatDate: opts.formatDate || formatDate },
    HtmlService: {}
  };
  vm.createContext(ctx);
  // opts.sources: [{ name, code }] — мысалы, біріктірілген install/Code.gs
  const sources = opts.sources || ['Dates.gs', 'Sheet.gs', 'Code.gs'].map((f) => ({
    name: f, code: fs.readFileSync(path.join(GS_DIR, f), 'utf8')
  }));
  for (const s of sources) vm.runInContext(s.code, ctx, { filename: s.name });
  // vm контекстінен шыққан объектілерді қарапайым JSON-ға айналдыру (deepStrictEqual үшін)
  const api = {};
  for (const k of Object.keys(ctx)) {
    if (typeof ctx[k] === 'function') {
      api[k] = (...args) => {
        const r = ctx[k](...JSON.parse(JSON.stringify(args)));
        return r === undefined ? r : JSON.parse(JSON.stringify(r));
      };
    }
  }
  api._ctx = ctx;
  return api;
}

module.exports = { FakeSheet, FakeSpreadsheet, loadApp };
