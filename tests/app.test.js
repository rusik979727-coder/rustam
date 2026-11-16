'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./fake-gas');
const { sampleSpreadsheet } = require('./fixture');

function setup(opts) {
  const ss = sampleSpreadsheet();
  return { ss, app: loadApp(ss, opts) };
}

// ───────── Dates.gs ─────────

test('парақ атауларын күнге айналдырады', () => {
  const { app } = setup();
  assert.equal(app.parseSheetName('5.11.2026'), '2026-11-05');
  assert.equal(app.parseSheetName('16.11.2026'), '2026-11-16');
  assert.equal(app.parseSheetName('18.11.26'), '2026-11-18');
  assert.equal(app.parseSheetName('10.112026'), '2026-11-10');
  assert.equal(app.parseSheetName(' 7.11.2026 '), '2026-11-07');
  assert.equal(app.parseSheetName('5.11.2026 (копия)'), null);
  assert.equal(app.parseSheetName('Лист5'), null);
  assert.equal(app.parseSheetName('31.02.2026'), null);
});

test('жаңа парақ атауы және күн қосу', () => {
  const { app } = setup();
  assert.equal(app.formatSheetName('2026-11-19'), '19.11.2026');
  assert.equal(app.formatSheetName('2027-01-05'), '5.01.2027');
  assert.equal(app.addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(app.addDays('2026-01-01', -1), '2025-12-31');
});

test('уақытты талдау', () => {
  const { app } = setup();
  assert.equal(app.parseTime('9:00'), 540);
  assert.equal(app.parseTime('19'), 1140);
  assert.equal(app.parseTime('18:30'), 1110);
  assert.equal(app.parseTime(''), null);
  assert.equal(app.parseTime('ФИ'), null);
  assert.equal(app.formatMinutes(545), '09:05');
});

test('телефонды қалыпқа келтіру', () => {
  const { app } = setup();
  assert.deepEqual(app.normalizePhone('‪+7 747 685 7481‬'), { display: '+7 747 685 74 81', digits: '77476857481' });
  assert.deepEqual(app.normalizePhone('87011112233'), { display: '+7 701 111 22 33', digits: '77011112233' });
  assert.deepEqual(app.normalizePhone('7011112233'), { display: '+7 701 111 22 33', digits: '77011112233' });
  assert.equal(app.normalizePhone('123').display, '123');
  assert.equal(app.normalizePhone('').display, '');
});

// ───────── Sheet.gs / getDay ─────────

test('күндер тізімі: тек күн парақтары, сұрыпталған', () => {
  const { app } = setup();
  const boot = app.getBootstrap();
  assert.deepEqual(boot.days.map((d) => d.sheet), ['5.11.2026', '10.112026', '16.11.2026', '18.11.26']);
  assert.match(boot.today, /^\d{4}-\d{2}-\d{2}$/);
});

test('дәрігер слоттары нақты құрылыммен оқылады', () => {
  const { app } = setup();
  const day = app.getDay('16.11.2026');
  assert.equal(day.date, '2026-11-16');
  assert.equal(day.doctor.length, 29);
  assert.equal(day.doctor[0].time, '09:00');
  assert.equal(day.doctor[0].row, 3);
  assert.equal(day.doctor.at(-1).time, '19:00');
  const g = day.doctor.find((s) => s.row === 18);
  assert.equal(g.time, '14:00');
  assert.equal(g.name, 'Гүлмира');
  assert.equal(g.phone, '+7 747 000 11 22');
  assert.equal(g.booked, true);
  // Тек «услуга» толтырылған жол — бос слот деп саналады
  assert.equal(day.doctor.find((s) => s.row === 6).booked, false);
  assert.deepEqual(day.options.recorder, ['Гулназ', 'Асель', 'Айсулу']);
});

test('физио блоктары: 3 орын, біріктірулер бойынша', () => {
  const { app } = setup();
  const day = app.getDay('16.11.2026');
  assert.equal(day.physio[0].time, '08:30');
  assert.deepEqual(day.physio[0].places.map((p) => p.row), [3, 4, 5]);
  const b9 = day.physio.find((b) => b.time === '09:00');
  assert.equal(b9.taken, 1);
  assert.equal(b9.places[2].name, 'Күнімай');
  // 15:30 блогынан кейінгі біріктірілмеген бос жолдар қосылмайды
  const b1530 = day.physio.find((b) => b.time === '15:30');
  assert.deepEqual(b1530.places.map((p) => p.row), [45, 46, 47]);
  assert.equal(day.physio.at(-1).time, '19:30');
  assert.ok(day.procedures.includes('Физио, системк'));
});

// ───────── Жазу операциялары ─────────

test('слотқа жазу және өзгерту', () => {
  const { app, ss } = setup();
  let day = app.getDay('16.11.2026');
  const slot = day.doctor.find((s) => s.time === '09:20');
  day = app.saveAppointment('16.11.2026', slot.row, {
    name: '  Әлия   Сәрсенқызы ', phone: '8 777 123 45 67', comment: '', recorder: 'Асель',
    source: '2ГИС', service: 'курс', attended: ''
  }, slot.prev);
  const saved = day.doctor.find((s) => s.row === slot.row);
  assert.equal(saved.name, 'Әлия Сәрсенқызы');
  assert.equal(saved.phone, '+7 777 123 45 67');
  // Телефон формула ретінде емес, мәтін ретінде сақталды
  assert.equal(ss.getSheetByName('16.11.2026')._get(slot.row, 3), '+7 777 123 45 67');
});

test('қақтығыс: басқа адам өзгертсе, жазу тоқтайды', () => {
  const { app, ss } = setup();
  const slot = app.getDay('16.11.2026').doctor.find((s) => s.time === '09:20');
  ss.getSheetByName('16.11.2026')._set(slot.row, 2, 'Басқа пациент');
  assert.throws(() => app.saveAppointment('16.11.2026', slot.row, { name: 'Мен' }, slot.prev), /CONFLICT/);
});

test('таблицада жоқ dropdown мәні қабылданбайды', () => {
  const { app } = setup();
  const slot = app.getDay('16.11.2026').doctor[1];
  assert.throws(() => app.saveAppointment('16.11.2026', slot.row, { name: 'А', source: 'Instagram' }, slot.prev), /Қайдан келді/);
});

test('аты да, телефоны да жоқ жазба қабылданбайды', () => {
  const { app } = setup();
  const slot = app.getDay('16.11.2026').doctor[1];
  assert.throws(() => app.saveAppointment('16.11.2026', slot.row, { comment: 'x' }, slot.prev), /атын немесе телефонын/);
});

test('уақыт емес жолға жазу мүмкін емес', () => {
  const { app } = setup();
  assert.throws(() => app.saveAppointment('16.11.2026', 2, { name: 'X' }, null), /дәрігер уақыты жоқ/);
  assert.throws(() => app.saveAppointment('16.11.2026', 40, { name: 'X' }, null), /дәрігер уақыты жоқ/);
});

test('келді/келмеді белгісі', () => {
  const { app } = setup();
  const g = app.getDay('16.11.2026').doctor.find((s) => s.row === 18);
  let day = app.setAttendance('16.11.2026', 18, '✅', g.prev);
  assert.equal(day.doctor.find((s) => s.row === 18).attended, '✅');
  const again = day.doctor.find((s) => s.row === 18);
  day = app.setAttendance('16.11.2026', 18, '', again.prev);
  assert.equal(day.doctor.find((s) => s.row === 18).attended, '');
});

test('жазбаны өшіру', () => {
  const { app } = setup();
  const g = app.getDay('16.11.2026').doctor.find((s) => s.row === 18);
  const day = app.clearAppointment('16.11.2026', 18, g.prev);
  const s = day.doctor.find((x) => x.row === 18);
  assert.equal(s.booked, false);
  assert.equal(s.service, '');
});

test('басқа уақытқа және басқа күнге көшіру', () => {
  const { app } = setup();
  const g = app.getDay('16.11.2026').doctor.find((s) => s.row === 18);
  let day = app.moveAppointment('16.11.2026', 18, '16.11.2026', 4, g.prev);
  assert.equal(day.doctor.find((s) => s.row === 4).name, 'Гүлмира');
  assert.equal(day.doctor.find((s) => s.row === 4).phone, '+7 747 000 11 22');
  assert.equal(day.doctor.find((s) => s.row === 18).booked, false);

  const moved = day.doctor.find((s) => s.row === 4);
  app.moveAppointment('16.11.2026', 4, '18.11.26', 10, moved.prev);
  assert.equal(app.getDay('18.11.26').doctor.find((s) => s.row === 10).name, 'Гүлмира');
});

test('бос емес слотқа көшіру мүмкін емес', () => {
  const { app } = setup();
  const g = app.getDay('16.11.2026').doctor.find((s) => s.row === 18);
  assert.throws(() => app.moveAppointment('16.11.2026', 18, '16.11.2026', 20, g.prev), /бос емес/);
});

test('физио орнына жазу және босату', () => {
  const { app } = setup();
  const block = app.getDay('16.11.2026').physio.find((b) => b.time === '08:30');
  const place = block.places[1];
  let day = app.savePhysio('16.11.2026', place.row, { name: 'Бақыт', proc: 'Физио' }, place.prev);
  let p = day.physio.find((b) => b.time === '08:30').places[1];
  assert.equal(p.name, 'Бақыт');
  day = app.savePhysio('16.11.2026', p.row, { name: '', proc: '' }, p.prev);
  p = day.physio.find((b) => b.time === '08:30').places[1];
  assert.equal(p.name, '');
  assert.throws(() => app.savePhysio('16.11.2026', 2, { name: 'X' }, null), /физио кестесіне жатпайды/);
});

test('жаңа күн: соңғы күннен көшіріледі, пациенттер тазаланады', () => {
  const { app, ss } = setup();
  const r = app.createDay('2026-11-17');
  assert.deepEqual(r, { sheet: '17.11.2026', created: true });
  const names = ss.getSheets().map((s) => s.getName());
  assert.deepEqual(names.slice(0, 4), ['5.11.2026', '10.112026', '16.11.2026', '17.11.2026']);
  const day = app.getDay('17.11.2026');
  assert.equal(day.doctor.length, 29);
  assert.equal(day.doctor.filter((s) => s.booked || s.service).length, 0);
  assert.equal(day.physio.length, 22);
  assert.equal(day.physio.reduce((n, b) => n + b.taken, 0), 0);
  // Түпнұсқа парақ өзгермеді
  assert.equal(app.getDay('16.11.2026').doctor.find((s) => s.row === 18).name, 'Гүлмира');
  // Қайта шақыру жаңа парақ жасамайды
  assert.deepEqual(app.createDay('2026-11-17'), { sheet: '17.11.2026', created: false });
});

test('пациентті іздеу: аты және телефоны бойынша', () => {
  const { app } = setup();
  const byName = app.searchPatient('гүлмира');
  assert.equal(byName.length, 1);
  assert.equal(byName[0].date, '2026-11-16');
  const byPhone = app.searchPatient('8701 111');
  assert.deepEqual(byPhone.map((r) => r.name).sort(), ['Ербол', 'Нұрлан']);
  const physio = app.searchPatient('Раушан');
  assert.equal(physio[0].kind, 'physio');
  assert.deepEqual(app.searchPatient('а'), []);
});

test('статистика кезең бойынша', () => {
  const { app } = setup();
  const st = app.getStats('2026-11-01', '2026-11-16');
  assert.equal(st.total, 3);
  assert.equal(st.came, 1);
  assert.equal(st.missed, 1);
  assert.equal(st.unmarked, 1);
  assert.equal(st.physio, 5);
  assert.equal(st.bySource['2ГИС'], 1);
  assert.equal(st.days.length, 3);
  assert.equal(app.getStats('2026-11-17', '2026-11-30').total, 0);
});

test('құлып алынбаса түсінікті қате', () => {
  const { app } = setup({ lockFails: true });
  assert.throws(() => app.saveAppointment('16.11.2026', 3, { name: 'X' }, null), /басқа адам өзгертіп жатыр/);
});
