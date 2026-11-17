// node dev/test-ui.js — opens Index.html in Chromium with Code.gs running on the fake sheet.
const fs = require("fs"), path = require("path"), assert = require("assert");
const { chromium, devices } = require("playwright");
const dir = path.join(__dirname, "..");
const norm = (t) => String(t).replace(/[\u00a0\u202f]/g, " ");
const read = (f) => fs.readFileSync(path.join(dir, f), "utf8");
const shim = `
${read("dev/fake-gas.js")}
${read("dev/seed.js")}
${read("dev/sample.js")}
${read("Code.gs")}
Object.assign(window, { getData, savePatient, removePatient, addPayment, removePayment, addExpense, removeExpense });
window.__seed(window.__sample);
window.google = { script: { get run() {
  let ok = () => {}, fail = () => {};
  const runner = new Proxy({}, { get(_, fn) {
    if (fn === "withSuccessHandler") return (f) => { ok = f; return runner; };
    if (fn === "withFailureHandler") return (f) => { fail = f; return runner; };
    return (...args) => setTimeout(() => { try { ok(JSON.parse(JSON.stringify(window[fn](...args.map((a) => JSON.parse(JSON.stringify(a))))))); } catch (e) { fail(e); } }, 50);
  } });
  return runner;
} } };`;
(async () => {
  const out = process.argv[2] || path.join(dir, "dev");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"], timezoneId: "Asia/Almaty" });
  await ctx.clock?.setFixedTime?.(new Date("2026-11-17T10:00:00+05:00"));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.addInitScript(shim);
  await page.goto("file://" + path.join(dir, "Index.html"));
  await page.waitForSelector("#loading", { state: "hidden" });
  // month view
  await page.click('#periodSeg button[data-p="month"]');
  assert.equal(norm(await page.textContent("#tTotal")), "915 000 ₸");
  assert.equal(norm(await page.textContent("#tExp")), "70 925 ₸");
  await page.screenshot({ path: path.join(out, "shot-top.png") });

  // new treatment payment with course dates, split into two methods
  await page.fill("#pname", "Жаңа пациент");
  await page.click('#kinds button[data-k="treatment"]');
  assert.equal(await page.inputValue("#tstart"), "2026-11-17");
  await page.fill("#cost", "200000");
  await page.fill("#tend", "2026-11-26");
  await page.fill("#amount", "80000");
  await page.click("#splitToggle");
  await page.fill("#amount2", "20000");
  await page.click("#save");
  await page.waitForFunction(() => document.getElementById("msg").classList.contains("ok"));
  assert.match(norm(await page.textContent("#msg")), /100 000 ₸ таблицаға жазылды/);
  assert.equal(norm(await page.textContent("#tTotal")), "1 015 000 ₸");
  const rows = await page.evaluate(() => window.__fakeSheets["Төлемдер"].data.slice(1, 12).filter((r) => r[2]).map((r) => [window.__display(r[0]), window.__display(r[1]), r[2], r[4], r[5]]));
  assert.deepEqual(rows.slice(-2).map((r) => r[4]), [80000, 20000]);
  const pRow = await page.evaluate(() => window.__fakeSheets["Пациенттер"].data.find((r) => r[0] === "Жаңа пациент").map(window.__display));
  assert.deepEqual([pRow[1], pRow[2], pRow[5]], ["17.11.2026", "26.11.2026", "200000"]);

  // patient list shows course status and allows editing dates
  await page.fill("#search", "клара");
  await page.click("details.pt summary");
  assert.match(await page.textContent("details.pt .pmeta"), /Ем күні жазылмаған/);
  const inputs = page.locator("details.pt .pedit input");
  await inputs.nth(1).fill("2026-11-11");
  await inputs.nth(2).fill("2026-11-20");
  await page.click("details.pt .pedit button");
  await page.waitForFunction(() => /Емделуде/.test(document.querySelector("details.pt .pmeta")?.textContent || ""));
  assert.match(await page.textContent("details.pt .pmeta"), /11\.11\.2026 – 20\.11\.2026 \(10 күн\).*Емделуде · 7\/10-күн/);
  await page.screenshot({ path: path.join(out, "shot-patient.png") });

  // treatment journal table with course dates
  await page.fill("#search", "");
  await page.click('#jtabs button[data-j="treatment"]');
  await page.locator("#journal").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, "shot-journal.png") });

  // expense
  await page.click('#modeSeg button[data-m="exp"]');
  await page.fill("#eamount", "15000");
  await page.click("#esave");
  await page.waitForFunction(() => document.getElementById("emsg").classList.contains("ok"));
  assert.equal(norm(await page.textContent("#tExp")), "85 925 ₸");

  // delete a consultation (two taps)
  await page.click('#jtabs button[data-j="consult"]');
  const del = page.locator("#journal .entry button").first();
  await del.click(); await del.click();
  await page.waitForFunction(() => document.getElementById("tTotal").textContent.replace(/[\u00a0\u202f]/g, " ") === "1 010 000 ₸");

  // server error is shown, not swallowed
  await page.click('#modeSeg button[data-m="pay"]');
  await page.fill("#pname", "Тест");
  await page.click('#kinds button[data-k="treatment"]');
  await page.fill("#tstart", "2026-11-20"); await page.fill("#tend", "2026-11-10");
  await page.fill("#amount", "1000");
  await page.click("#save");
  assert.match(norm(await page.textContent("#msg")), /ерте/);
  await page.setViewportSize({ width: 390, height: 2400 });
  await page.screenshot({ path: path.join(out, "shot-full.png"), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.equal(overflow, false, "horizontal overflow");
  assert.deepEqual(errors, []);
  await browser.close();
  console.log("ui tests: ok");
})().catch((e) => { console.error(e); process.exit(1); });
