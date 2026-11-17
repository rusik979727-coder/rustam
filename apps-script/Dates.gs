/**
 * Күн, уақыт және телефон нөмірімен жұмыс істейтін таза функциялар.
 * Apps Script API-ін қолданбайды, сондықтан Node-та тестіленеді.
 */

// "5.11.2026", "16.11.2026", "18.11.26", қате жазылған "10.112026" — бәрі танылады.
// "5.11.2026 (копия)", "Лист5" сияқты парақтар күн емес.
var DATE_SHEET_RE = /^\s*(\d{1,2})\.(\d{1,2})\.?(\d{4}|\d{2})\s*$/;

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Парақ атауын ISO күнге айналдырады ("2026-11-16") немесе null қайтарады. */
function parseSheetName(name) {
  var m = DATE_SHEET_RE.exec(String(name == null ? '' : name));
  if (!m) return null;
  var d = Number(m[1]);
  var mo = Number(m[2]);
  var y = Number(m[3]);
  if (y < 100) y += 2000;
  if (mo < 1 || mo > 12 || d < 1) return null;
  var check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return y + '-' + pad2_(mo) + '-' + pad2_(d);
}

/** ISO күннен жаңа парақ атауын жасайды: "2026-11-19" → "19.11.2026". */
function formatSheetName(iso) {
  var p = splitIso_(iso);
  return p.d + '.' + pad2_(p.m) + '.' + p.y;
}

function splitIso_(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  if (!m) throw new Error('Күн форматы қате: ' + iso);
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

/** ISO күнге n күн қосады. */
function addDays(iso, n) {
  var p = splitIso_(iso);
  var dt = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return dt.getUTCFullYear() + '-' + pad2_(dt.getUTCMonth() + 1) + '-' + pad2_(dt.getUTCDate());
}

/** "9:00" → 540, "19" → 1140, "9.30" → 570. Уақыт емес болса null. */
function parseTime(s) {
  var m = /^\s*(\d{1,2})(?:[:.](\d{2}))?\s*$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  var h = Number(m[1]);
  var min = m[2] ? Number(m[2]) : 0;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 540 → "09:00" */
function formatMinutes(total) {
  return pad2_(Math.floor(total / 60)) + ':' + pad2_(total % 60);
}

/**
 * Телефонды қалыпқа келтіреді. Таблицада нөмірлер "+7 747 685 7481" сияқты
 * көрінбейтін бағыт таңбаларымен келеді — олар алынып тасталады.
 * Нәтиже: { display: "+7 747 685 74 81", digits: "77476857481" }.
 * Қазақстан нөміріне ұқсамаса, мәтін тек тазаланып қайтарылады.
 */
function normalizePhone(raw) {
  var cleaned = String(raw == null ? '' : raw)
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .trim();
  var digits = cleaned.replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) {
    digits = '7' + digits.slice(1);
  } else if (digits.length === 10 && digits[0] === '7') {
    digits = '7' + digits;
  } else {
    return { display: cleaned, digits: digits };
  }
  var display = '+7 ' + digits.slice(1, 4) + ' ' + digits.slice(4, 7) + ' ' +
    digits.slice(7, 9) + ' ' + digits.slice(9, 11);
  return { display: display, digits: digits };
}
