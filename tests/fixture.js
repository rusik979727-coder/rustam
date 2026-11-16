// Нақты «БЕЛЕС ГРАФИК» парағының құрылымын қайталайтын тест деректері.
// Пациент аттары мен нөмірлері ойдан алынған.
'use strict';
const { FakeSheet, FakeSpreadsheet } = require('./fake-gas');

const DOCTOR_TIMES = ['9:00', '9:20', '9:40', '10:00', '10:20', '10:40', '11:00', '11:20', '11:40',
  '12:00', '12:20', '12:40', '13:00', '13:20', '13:40', '14:00', '14:20', '14:40', '15:00', '15:20',
  '15:40', '16:00', '16:20', '16:40', '17:00', '17:20', '17:40', '18:30', '19'];

// Физио уақыттары мен олардың жолдары (таблицада 16:00 мен 17:00 арасында 16:30 жоқ, бос жолдар бар).
const PHYSIO = [];
['8:30', '9:00', '9:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30',
  '14:00', '14:30', '15:00', '15:30'].forEach((t, i) => PHYSIO.push({ time: t, row: 3 + i * 3 }));
['16:00', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30'].forEach((t, i) => PHYSIO.push({ time: t, row: 51 + i * 3 }));

const VALIDATION = {
  5: ['Гулназ', 'Асель', 'Айсулу'],
  6: ['Таргет', '2ГИС', 'По рек'],
  7: ['первичный', 'повторный', 'курс'],
  8: ['✅', '❌']
};

/**
 * doctor: { [row]: [name, phone, comment, recorder, source, service, attended] }
 * physio: { [row]: [name, proc, total, day] }  (K–N бағандары)
 */
function daySheet(name, { doctor = {}, physio = {} } = {}) {
  const values = Array.from({ length: 80 }, () => Array(14).fill(''));
  values[1].splice(0, 8, ' ', 'ФИ пациента', 'номер', 'коммент', 'записал', 'источник', 'услуга', 'пд');
  DOCTOR_TIMES.forEach((t, i) => { values[2 + i][0] = t; });
  PHYSIO.forEach((p) => { values[p.row - 1][9] = p.time; });
  for (const [row, vals] of Object.entries(doctor)) vals.forEach((v, i) => { values[row - 1][1 + i] = v; });
  for (const [row, vals] of Object.entries(physio)) vals.forEach((v, i) => { values[row - 1][10 + i] = v; });

  const merges = [];
  for (let start = 3; start <= 45; start += 3) merges.push({ col: 10, start, end: start + 2 });
  for (let start = 51; start <= 78; start += 3) merges.push({ col: 10, start, end: start + 2 });
  return new FakeSheet(name, { values, merges, validation: VALIDATION });
}

function sampleSpreadsheet() {
  return new FakeSpreadsheet([
    daySheet('5.11.2026', {
      physio: { 11: ['Айгерім ', ''], 14: ['Сәуле ', ''] }
    }),
    daySheet('10.112026', {
      doctor: { 3: ['Нұрлан', '87011112233', '', 'Асель', '2ГИС', 'первичный', '✅'] },
      physio: { 15: ['Жумахан  ага', 'Физио', '10', '1'], 24: ['Сәуле', 'Плазма', '3', '3'] }
    }),
    daySheet('16.11.2026', {
      doctor: {
        6: ['', '', '', '', '', 'первичный', ''],
        18: ['Гүлмира', '‪+7 747 000 1122‬', 'Белі ауырады', 'Гулназ', 'Таргет', 'первичный', ''],
        20: ['Ербол', '+7 701 111 22 33', '', 'Айсулу', 'По рек', 'повторный', '❌']
      },
      physio: { 8: ['Күнімай', 'Физио, системк'], 14: ['Жұмахан аға', 'Физио', '10', '2'], 21: ['Раушан', 'Физио'] }
    }),
    daySheet('18.11.26'),
    daySheet('5.11.2026 (копия)', { physio: { 11: ['Айгерім', ''] } }),
    new FakeSheet('Лист5', {})
  ]);
}

module.exports = { daySheet, sampleSpreadsheet, DOCTOR_TIMES };
