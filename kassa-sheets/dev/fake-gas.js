// Minimal in-memory stand-in for the Apps Script services Code.gs uses, so the app can be
// exercised in a browser or Node without a real spreadsheet. Dates in cells are Date objects
// (midnight Asia/Almaty, UTC+5), times are day fractions, like real Sheets.
(function (g) {
  const TZ_OFFSET_H = 5;
  const pad = (n) => String(n).padStart(2, "0");
  function localParts(d) { const t = new Date(d.getTime() + TZ_OFFSET_H * 3600000); return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()]; }
  function display(v) {
    if (v instanceof Date) { const [y, m, d] = localParts(v); return pad(d) + "." + pad(m) + "." + y; }
    if (typeof v === "number" && v > 0 && v < 1) { const mins = Math.round(v * 1440); return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60); }
    if (v === "" || v == null) return "";
    return String(v);
  }
  function cmp(a, b) {
    const blank = (x) => x === "" || x == null;
    if (blank(a) && blank(b)) return 0; if (blank(a)) return 1; if (blank(b)) return -1;
    const na = a instanceof Date ? a.getTime() : a, nb = b instanceof Date ? b.getTime() : b;
    if (typeof na === "number" && typeof nb === "number") return na - nb;
    if (typeof na === "number") return -1; if (typeof nb === "number") return 1;
    return String(na).localeCompare(String(nb));
  }
  class Sheet {
    constructor(name, rows, cols) { this.name = name; this.cols = cols; this.data = Array.from({ length: rows }, () => Array(cols).fill("")); }
    getMaxRows() { return this.data.length; }
    insertRowsAfter(after, n) { this.data.splice(after, 0, ...Array.from({ length: n }, () => Array(this.cols).fill(""))); }
    getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  }
  class Range {
    constructor(sh, r, c, nr, nc) {
      if (r < 1 || r + nr - 1 > sh.data.length || c < 1 || c + nc - 1 > sh.cols) throw new Error("Range out of bounds " + sh.name + " " + [r, c, nr, nc]);
      Object.assign(this, { sh, r, c, nr, nc });
    }
    getValues() { return this.sh.data.slice(this.r - 1, this.r - 1 + this.nr).map((row) => row.slice(this.c - 1, this.c - 1 + this.nc)); }
    getDisplayValues() { return this.getValues().map((row) => row.map(display)); }
    getValue() { return this.getValues()[0][0]; }
    setValues(v) {
      if (v.length !== this.nr || v.some((row) => row.length !== this.nc)) throw new Error("setValues size mismatch");
      v.forEach((row, i) => row.forEach((x, j) => { this.sh.data[this.r - 1 + i][this.c - 1 + j] = x; }));
      return this;
    }
    setValue(x) { return this.setValues([[x]]); }
    clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(""))); }
    copyTo() { /* formulas are not modelled */ }
    sort(specs) {
      const rows = this.getValues();
      rows.sort((a, b) => { for (const s of specs) { const d = cmp(a[s.column - this.c], b[s.column - this.c]); if (d) return s.ascending === false ? -d : d; } return 0; });
      this.setValues(rows);
    }
  }
  const sheets = {};
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    getSpreadsheetTimeZone: () => "Asia/Almaty",
    getUrl: () => "https://docs.google.com/spreadsheets/d/fake/edit",
  };
  g.__fakeSheets = sheets;
  g.__addSheet = (name, rows, cols) => (sheets[name] = new Sheet(name, rows, cols));
  g.__display = display;
  g.SpreadsheetApp = { getActiveSpreadsheet: () => ss, flush() {} };
  g.LockService = { getDocumentLock: () => ({ tryLock: () => true, releaseLock() {} }) };
  g.Session = { getActiveUser: () => ({ getEmail: () => "" }) };
  g.HtmlService = {};
  g.Utilities = {
    formatDate(d, tz, f) {
      let y, m, day;
      if (tz === "UTC") { y = d.getUTCFullYear(); m = d.getUTCMonth() + 1; day = d.getUTCDate(); } else [y, m, day] = localParts(d);
      if (f !== "yyyy-MM-dd") throw new Error("fmt " + f);
      return y + "-" + pad(m) + "-" + pad(day);
    },
    parseDate(s, tz, f) { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d) - TZ_OFFSET_H * 3600000); },
  };
})(typeof window !== "undefined" ? window : globalThis);
