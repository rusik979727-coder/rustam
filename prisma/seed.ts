/**
 * Демо-деректер: `npm run seed`
 * Логиндер (құпиясөз beles123): head — бас менеджер; aigerim, dana, erlan — менеджерлер
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
  for (const m of ["auditLog", "message", "task", "leadActivity", "lead", "monthlyPlan", "loginAttempt", "user"] as const) {
    // @ts-expect-error dynamic model access
    await db[m].deleteMany();
  }

  const hash = await bcrypt.hash("beles123", 10);
  const head = await db.user.create({ data: { name: "Жанар Сейтқали", login: "head", passwordHash: hash, role: "HEAD_MANAGER" } });
  const m1 = await db.user.create({ data: { name: "Әйгерім Нұрланқызы", login: "aigerim", passwordHash: hash, role: "MANAGER" } });
  const m2 = await db.user.create({ data: { name: "Дана Төлеген", login: "dana", passwordHash: hash, role: "MANAGER" } });
  const m3 = await db.user.create({ data: { name: "Ерлан Бекболат", login: "erlan", passwordHash: hash, role: "MANAGER" } });
  const managers = [m1, m2, m3];

  const names = [
    "Серік Жұмабаев", "Гүлмира Әлиева", "Бауыржан Қасымов", "Айгүл Темірова", "Нұрлан Сапаров", "Сәуле Мұхамедова",
    "Ержан Иманов", "Мадина Ахметжан", "Қайрат Оспанов", "Жансая Бекова", "Ринат Ғалиев", "Ләззат Нұрова",
    "Талғат Есенов", "Әсем Қуанышева", "Дәурен Мұратов", "Гаухар Сейітова", "Асхат Жақсылықов", "Ботагөз Әбенова",
    "Марат Тоқтаров", "Индира Қалиева", "Ғалым Байжанов", "Айнұр Сұлтанова", "Олжас Рахимов", "Динара Әміржан",
    "Бекзат Ысқақов", "Аружан Мырзахмет", "Нұржан Қалдыбаев", "Камила Төлеуова",
  ];
  const sources = ["INSTAGRAM", "INSTAGRAM", "INSTAGRAM", "WHATSAPP", "WHATSAPP", "2GIS", "SITE", "CALL", "REFERRAL"] as const;
  const complaints = ["HERNIA", "HERNIA", "PROTRUSION", "PROTRUSION", "ARTHROSIS", "ARTHRITIS", "OTHER"] as const;
  const statuses = ["NEW", "CONTACTED", "CONTACTED", "NO_ANSWER", "BOOKED", "BOOKED", "ARRIVED", "PAID", "PAID", "LOST", "SPAM"] as const;

  for (let i = 0; i < names.length; i++) {
    const phone = `+7701${String(1000000 + i * 37117).slice(0, 7)}`;
    const status = i < 3 ? "NEW" : rnd(statuses);
    const created = i < 3 ? new Date(Date.now() - (i + 1) * 25 * 60000) : daysAgo(Math.floor(Math.random() * 25) + 1, 9 + (i % 8), 15);
    const manager = i === 2 ? null : managers[i % 3];
    const reached = ["BOOKED", "ARRIVED", "PAID"].includes(status);
    // Конс: «Конс» бағанындағылар — бүгін/ертең, келгендер — өткен күндер
    let consultAt: Date | null = null;
    if (status === "BOOKED") {
      consultAt = new Date();
      consultAt.setDate(consultAt.getDate() + (i % 2));
      consultAt.setHours(10 + (i % 8), i % 2 ? 30 : 0, 0, 0);
    } else if (reached) {
      // Келгендер/төлегендер — конс пен төлем әрқашан өткен уақытта
      consultAt = new Date(Math.min(created.getTime() + 2 * 86400000, Date.now() - 3 * 3600_000));
    }
    const paidAt = status === "PAID" ? new Date(consultAt!.getTime() + 3600_000) : null;

    const lead = await db.lead.create({
      data: {
        name: names[i],
        phone,
        source: rnd(sources),
        complaint: rnd(complaints),
        status,
        managerId: manager?.id ?? null,
        lostReason: status === "LOST" ? rnd(["EXPENSIVE", "FAR", "NO_ANSWER", "OTHER_CLINIC", "NOT_NOW"]) : null,
        createdAt: created,
        firstResponseAt: status === "NEW" ? null : new Date(created.getTime() + (3 + Math.random() * 30) * 60000),
        nextContactAt: status === "CONTACTED" || status === "NO_ANSWER" ? daysAgo(-Math.floor(Math.random() * 2), 15) : null,
        consultAt,
        consultConfirmedAt: status === "BOOKED" && i % 3 === 0 ? new Date() : null,
        amount: status === "PAID" ? rnd([120000, 150000, 180000, 220000]) : null,
        paidAt,
        activities: { create: [{ type: "SYSTEM", text: "Өтінім түсті", createdAt: created }] },
      },
    });
    if (status !== "NEW") {
      await db.leadActivity.create({
        data: { leadId: lead.id, userId: manager?.id, type: "CALL", text: "Қоңырау шалдым, шағымын анықтадым, МРТ бар-жоғын сұрадым", createdAt: new Date(created.getTime() + 600000) },
      });
    }
  }

  const month = new Date().toISOString().slice(0, 7);
  await db.monthlyPlan.create({ data: { month, managerId: null, leads: 120, bookings: 60, revenue: 6_000_000 } });
  for (const m of managers) await db.monthlyPlan.create({ data: { month, managerId: m.id, leads: 40, bookings: 20, revenue: 2_000_000 } });

  await db.task.create({ data: { title: "Instagram жарнамасынан келген өтінімдерді тексеру", assigneeId: head.id, dueAt: new Date() } });
  await db.task.create({ data: { title: "Кеше «Не отвечает» болғандарға қайта қоңырау", assigneeId: m1.id, dueAt: daysAgo(1, 12), kind: "CALLBACK" } });

  console.log("Seed дайын. Логин: head / beles123");
}

main().finally(() => db.$disconnect());
