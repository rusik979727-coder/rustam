/**
 * Демо-деректер: `npm run seed`
 * Логиндер: head / beles123 (бас менеджер), aigerim, dana / beles123 (менеджер), doctor / beles123 (дәрігер)
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const db = new PrismaClient();
const rnd = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
const daysAgo = (n: number, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d;
};

async function main() {
  // Продакшнда демо-деректер барлық нақты деректерді өшіреді — қорғаныс
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_SEED !== "yes") {
    throw new Error("Продакшнда seed тыйым салынған (барлық деректерді өшіреді). Қажет болса ALLOW_DEMO_SEED=yes");
  }
  // тазалау (тәуелділік ретімен)
  for (const m of ["auditLog", "task", "payment", "appointment", "medicalNote", "attachment", "treatmentCourse", "leadActivity", "lead", "patient", "monthlyPlan", "service", "doctor", "user"] as const) {
    // @ts-expect-error dynamic model access
    await db[m].deleteMany();
  }

  const hash = await bcrypt.hash("beles123", 10);
  const head = await db.user.create({ data: { name: "Жанар Сейтқали", login: "head", passwordHash: hash, role: "HEAD_MANAGER" } });
  const m1 = await db.user.create({ data: { name: "Әйгерім Нұрланқызы", login: "aigerim", passwordHash: hash, role: "MANAGER" } });
  const m2 = await db.user.create({ data: { name: "Дана Төлеген", login: "dana", passwordHash: hash, role: "MANAGER" } });
  const m3 = await db.user.create({ data: { name: "Ерлан Бекболат", login: "erlan", passwordHash: hash, role: "MANAGER" } });
  const du = await db.user.create({ data: { name: "Д-р Асқар Омаров", login: "doctor", passwordHash: hash, role: "DOCTOR" } });
  const managers = [m1, m2, m3];

  const d1 = await db.doctor.create({ data: { name: "Асқар Омаров", specialty: "Невролог", room: "101", userId: du.id } });
  const d2 = await db.doctor.create({ data: { name: "Гүлнар Ахметова", specialty: "Ортопед-травматолог", room: "102" } });
  const d3 = await db.doctor.create({ data: { name: "Нұржан Сәрсенов", specialty: "Кинезиотерапевт", room: "Зал" } });
  const doctors = [d1, d2, d3];

  const svc = await Promise.all(
    [
      ["Алғашқы консультация", "Первичная консультация", 8000, 30],
      ["МРТ қорытындысын талдау", "Разбор МРТ", 5000, 20],
      ["Физиотерапия", "Физиотерапия", 6000, 30],
      ["Емдік массаж", "Лечебный массаж", 7000, 45],
      ["Кинезиотерапия", "Кинезиотерапия", 9000, 60],
      ["Блокада", "Блокада", 15000, 20],
      ["Плазмотерапия (PRP)", "Плазмотерапия (PRP)", 25000, 30],
      ["Курстағы сеанс", "Сеанс курса", 0, 60],
    ].map(([nameKk, nameRu, price, durationMin]) =>
      db.service.create({ data: { nameKk: String(nameKk), nameRu: String(nameRu), price: Number(price), durationMin: Number(durationMin) } }),
    ),
  );

  const names = [
    "Серік Жұмабаев", "Гүлмира Әлиева", "Бауыржан Қасымов", "Айгүл Темірова", "Нұрлан Сапаров", "Сәуле Мұхамедова",
    "Ержан Иманов", "Мадина Ахметжан", "Қайрат Оспанов", "Жансая Бекова", "Ринат Ғалиев", "Ләззат Нұрова",
    "Талғат Есенов", "Әсем Қуанышева", "Дәурен Мұратов", "Гаухар Сейітова", "Асхат Жақсылықов", "Ботагөз Әбенова",
    "Марат Тоқтаров", "Индира Қалиева", "Ғалым Байжанов", "Айнұр Сұлтанова", "Олжас Рахимов", "Динара Әміржан",
  ];
  const sources = ["INSTAGRAM", "INSTAGRAM", "INSTAGRAM", "WHATSAPP", "WHATSAPP", "2GIS", "SITE", "CALL", "REFERRAL"] as const;
  const complaints = ["HERNIA", "HERNIA", "PROTRUSION", "PROTRUSION", "ARTHROSIS", "ARTHRITIS", "OTHER"] as const;
  const statuses = ["NEW", "CONTACTED", "CONTACTED", "NO_ANSWER", "BOOKED", "ARRIVED", "PAID", "PAID", "LOST", "SPAM"] as const;

  for (let i = 0; i < names.length; i++) {
    const phone = `+7701${String(1000000 + i * 37117).slice(0, 7)}`;
    const status = i < 3 ? "NEW" : rnd(statuses);
    const created = i < 3 ? new Date(Date.now() - (i + 1) * 25 * 60000) : daysAgo(Math.floor(Math.random() * 25) + 1, 9 + (i % 8), 15);
    const manager = i === 2 ? null : managers[i % 3];
    const complaint = rnd(complaints);
    const needsPatient = ["BOOKED", "ARRIVED", "PAID"].includes(status);
    const patient = needsPatient
      ? await db.patient.create({ data: { fullName: names[i], phone, diagnosis: complaint, hasMri: Math.random() > 0.4, createdAt: created } })
      : null;

    const lead = await db.lead.create({
      data: {
        name: names[i],
        phone,
        source: rnd(sources),
        complaint,
        status,
        managerId: manager?.id ?? null,
        patientId: patient?.id ?? null,
        lostReason: status === "LOST" ? rnd(["EXPENSIVE", "FAR", "NO_ANSWER", "OTHER_CLINIC", "NOT_NOW"]) : null,
        createdAt: created,
        firstResponseAt: status === "NEW" ? null : new Date(created.getTime() + (3 + Math.random() * 30) * 60000),
        nextContactAt: status === "CONTACTED" || status === "NO_ANSWER" ? daysAgo(-Math.floor(Math.random() * 2), 15) : null,
        activities: { create: [{ type: "SYSTEM", text: "Өтінім түсті", createdAt: created }] },
      },
    });
    if (status !== "NEW") {
      await db.leadActivity.create({ data: { leadId: lead.id, userId: manager?.id, type: "CALL", text: "Қоңырау шалдым, жағдайын сұрадым, МРТ бар-жоғын анықтадым", createdAt: new Date(created.getTime() + 600000) } });
    }

    if (patient) {
      const doc = rnd(doctors);
      // консультация
      const cStart = new Date(created.getTime() + 86400000);
      cStart.setHours(10 + (i % 7), i % 2 ? 30 : 0, 0, 0);
      await db.appointment.create({
        data: {
          patientId: patient.id, doctorId: d1.id, serviceId: svc[0].id, startAt: cStart, endAt: new Date(cStart.getTime() + 30 * 60000),
          status: status === "BOOKED" ? (cStart < new Date() ? "NO_SHOW" : "BOOKED") : "ARRIVED", price: svc[0].price, managerId: manager?.id,
        },
      });
      if (status !== "BOOKED") {
        await db.payment.create({ data: { patientId: patient.id, amount: svc[0].price, method: rnd(["KASPI", "KASPI", "CASH", "CARD"]), managerId: manager?.id, createdAt: cStart } });
        await db.medicalNote.create({ data: { patientId: patient.id, authorId: du.id, diagnosis: complaint, text: "Шағымы: бел аймағындағы ауырсыну, аяққа беріледі. Ұсыныс: 10 сеанстық кешенді ем.", createdAt: cStart } });
      }
      if (status === "PAID") {
        const price = rnd([120000, 150000, 180000, 220000]);
        const course = await db.treatmentCourse.create({
          data: { patientId: patient.id, doctorId: doc.id, title: `${complaint === "HERNIA" ? "Грыжа" : complaint === "PROTRUSION" ? "Протрузия" : complaint === "ARTHROSIS" ? "Артроз" : "Буын"} — кешенді ем (10 сеанс)`, totalSessions: 10, price, createdAt: cStart },
        });
        const paidPart = Math.random() > 0.5 ? price : price / 2;
        await db.payment.create({ data: { patientId: patient.id, amount: paidPart, method: rnd(["KASPI", "CARD", "TRANSFER"]), courseId: course.id, managerId: manager?.id, createdAt: cStart } });
        // өткен және алдағы сеанстар
        let done = 0;
        for (let s = 0; s < 6; s++) {
          const st = new Date(cStart.getTime() + (s + 1) * 2 * 86400000);
          st.setHours(9 + ((i + s) % 9), 0, 0, 0);
          const past = st < new Date();
          if (past) done++;
          await db.appointment.create({
            data: { patientId: patient.id, doctorId: d3.id, serviceId: svc[7].id, courseId: course.id, startAt: st, endAt: new Date(st.getTime() + 60 * 60000), status: past ? "ARRIVED" : "BOOKED", managerId: manager?.id },
          });
        }
        await db.treatmentCourse.update({ where: { id: course.id }, data: { doneSessions: done } });
      }
    }
  }

  // Бүгінгі қосымша жазбалар (кесте бос болмауы үшін)
  const ps = await db.patient.findMany({ take: 6 });
  for (let k = 0; k < ps.length; k++) {
    const st = new Date();
    st.setHours(9 + k * 2, k % 2 ? 30 : 0, 0, 0);
    const s = svc[[2, 3, 4, 1, 5, 6][k]];
    await db.appointment.create({
      data: { patientId: ps[k].id, doctorId: doctors[k % 3].id, serviceId: s.id, startAt: st, endAt: new Date(st.getTime() + s.durationMin * 60000), status: st < new Date() ? "ARRIVED" : k % 2 ? "CONFIRMED" : "BOOKED", price: s.price, managerId: managers[k % 3].id },
    });
  }

  const month = new Date().toISOString().slice(0, 7);
  await db.monthlyPlan.create({ data: { month, managerId: null, leads: 120, bookings: 80, revenue: 6_000_000 } });
  for (const m of managers) await db.monthlyPlan.create({ data: { month, managerId: m.id, leads: 40, bookings: 27, revenue: 2_000_000 } });

  await db.task.create({ data: { title: "Instagram жарнамасы бойынша келген өтінімдерді тексеру", assigneeId: head.id, dueAt: new Date() } });
  await db.task.create({ data: { title: "Өткен аптадағы келмегендерге қоңырау", assigneeId: m1.id, dueAt: daysAgo(1, 12), kind: "CALLBACK" } });

  console.log("Seed дайын. Логин: head / beles123");
}

main().finally(() => db.$disconnect());
