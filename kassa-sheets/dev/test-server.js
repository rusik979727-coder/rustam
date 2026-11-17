// node dev/test-server.js — checks Code.gs against the fake spreadsheet.
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const dir = path.join(__dirname, "..");
const ctx = { console, Date, Math, JSON, Number, String, Array, Object, Error, isFinite };
vm.createContext(ctx); ctx.globalThis = ctx;
for (const f of ["dev/fake-gas.js", "dev/seed.js", "dev/sample.js", "Code.gs"]) vm.runInContext(fs.readFileSync(path.join(dir, f), "utf8"), ctx, { filename: f });
ctx.__seed(ctx.__sample);
const run = (fn, ...a) => JSON.parse(JSON.stringify(ctx[fn](...a)));

let d = run("getData");
assert.equal(d.patients.length, 6);
assert.equal(d.payments.length, 8);
assert.deepEqual([d.payments[0].date, d.payments[0].time, d.payments[0].kind], ["2026-11-09", "09:00", "treatment"]);
assert.equal(d.patients[0].start, "2026-11-09");
assert.equal(d.expenses.reduce((a, x) => a + x.amount, 0), 70925);

// back-dated payment for a new patient lands in date order, patient is created with course dates
d = run("addPayment", { name: "  Жаңа   Пациент ", kind: "treatment", date: "2026-11-10", time: "08:05", note: "",
  parts: [{ method: "Карта", amount: 50000 }, { method: "Қолма-қол", amount: 10000 }], patient: { treatmentCost: 100000, start: "2026-11-10", end: "" } });
const np = d.patients.find((p) => p.name === "Жаңа Пациент");
assert.ok(np && np.treatmentCost === 100000 && np.start === "2026-11-10" && np.end === "");
const idx = d.payments.findIndex((x) => x.patientName === "Жаңа Пациент");
assert.equal(d.payments[idx - 1].date, "2026-11-09");
assert.equal(d.payments[idx].note, "бөліп төледі (1/2)");
assert.equal(d.payments[idx + 1].amount, 10000);
assert.equal(d.payments.length, 10);

// existing patient (different case/spaces) is matched, not duplicated; end date saved
d = run("addPayment", { name: "клара  АПА", kind: "consult", date: "2026-11-17", time: "12:00", parts: [{ method: "Kaspi QR", amount: 5000 }], patient: {} });
assert.equal(d.patients.filter((p) => p.name.toLowerCase().includes("клара")).length, 1);
d = run("savePatient", "Клара апа", { start: "2026-11-11", end: "2026-11-21", treatmentCost: 45000 });
const kl = d.patients.find((p) => p.name === "Клара апа");
assert.deepEqual([kl.start, kl.end, kl.treatmentCost], ["2026-11-11", "2026-11-21", 45000]);
assert.throws(() => ctx.savePatient("Клара апа", { start: "2026-11-21", end: "2026-11-11" }), /ерте/);

// delete a payment by content, even if the row number given is stale
const target = d.payments.find((x) => x.patientName === "Роза апа");
d = run("removePayment", { ...target, row: 2 });
assert.ok(!d.payments.some((x) => x.patientName === "Роза апа"));
assert.throws(() => ctx.removePayment(target), /өзгерген/);
// rows stay contiguous after delete+sort
const Y = ctx.__fakeSheets["Төлемдер"].data;
const filled = Y.slice(1).map((r) => r[0] !== "");
assert.equal(filled.indexOf(false), d.payments.length);

// patient with payments cannot be removed; without payments can
assert.throws(() => ctx.removePatient("Клара апа"), /төлемдері бар/);
d = run("removePatient", "Роза апа");
assert.ok(!d.patients.some((p) => p.name === "Роза апа"));
// freed row is reused
d = run("savePatient", "Тағы біреу", {});
assert.equal(d.patients.find((p) => p.name === "Тағы біреу").row, 7);

// expenses
d = run("addExpense", { category: "Жалақы", amount: 100000, date: "2026-11-01", method: "Аударым", note: "x" });
assert.equal(d.expenses[0].category, "Жалақы");
d = run("removeExpense", d.expenses[0]);
assert.equal(d.expenses.length, 2);
assert.throws(() => ctx.addExpense({ category: "??", amount: 1, date: "2026-11-01" }), /Санат/);
assert.throws(() => ctx.addPayment({ name: "A", kind: "consult", date: "2026-11-01", parts: [{ method: "Bitcoin", amount: 5 }] }), /тәсілі/);

// growth: fill payments sheet to the end
const sh = ctx.__fakeSheets["Төлемдер"];
const before = sh.getMaxRows();
for (let i = d.payments.length + 2; i <= before; i++) sh.data[i - 1][0] = ctx.Utilities.parseDate("2026-01-01", "", ""), sh.data[i - 1][2] = "Каламанов Ерболат", sh.data[i - 1][5] = 1;
run("addPayment", { name: "Каламанов Ерболат", kind: "consult", date: "2026-12-01", time: "", parts: [{ method: "Карта", amount: 5000 }] });
assert.ok(sh.getMaxRows() > before);
console.log("server tests: ok");
