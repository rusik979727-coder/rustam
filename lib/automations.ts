import { db } from "./db";
import { sendTelegram, sendSms } from "./notify";
import { decideReminder, lastInboundAt, sendText, sendTemplate, waConfigured, TEMPLATES, isWindowOpenFor, paidThisMonth } from "./whatsapp";
import { audit } from "./audit";
import { addDays, money, monthKey, startOfDay, startOfMonth, time, dateOnly, pct } from "./format";
import { funnel } from "./stats";

/** refKey бойынша бір рет қана тапсырма құрады (қайталанбайды). */
export async function ensureTask(data: { refKey: string; title: string; kind: string; assigneeId: number; dueAt: Date; leadId?: number | null }) {
  const exists = await db.task.findUnique({ where: { refKey: data.refKey } });
  if (exists) return exists;
  return db.task.create({ data });
}

/** Тапсырма кімге: өтінімнің менеджері, болмаса — бас менеджер. */
async function responsibleFor(lead: { managerId: number | null }) {
  if (lead.managerId) return lead.managerId;
  const head = await db.user.findFirst({ where: { role: "HEAD_MANAGER", active: true } });
  return head?.id ?? null;
}

/** 1) Жауапсыз өтінімдерді бас менеджерге эскалациялау. */
export async function escalateUnanswered(now = new Date()) {
  const minutes = Number(process.env.ESCALATION_MINUTES || 15);
  const leads = await db.lead.findMany({
    where: { status: "NEW", firstResponseAt: null, escalatedAt: null, createdAt: { lt: new Date(now.getTime() - minutes * 60000) } },
    include: { manager: true },
  });
  if (!leads.length) return 0;
  const head = await db.user.findFirst({ where: { role: "HEAD_MANAGER", active: true } });
  for (const l of leads) {
    await db.lead.update({ where: { id: l.id }, data: { escalatedAt: now } });
    await db.leadActivity.create({ data: { leadId: l.id, type: "SYSTEM", text: `Эскалация: ${minutes} минутта жауап жоқ` } });
    if (head) {
      await ensureTask({
        refKey: `escalation:${l.id}`,
        kind: "ESCALATION",
        title: `Жауапсыз өтінім: ${l.name} (${l.phone}), менеджер: ${l.manager?.name ?? "—"}`,
        assigneeId: head.id,
        dueAt: now,
        leadId: l.id,
      });
    }
  }
  await sendTelegram(
    `⚠️ <b>${leads.length}</b> өтінімге ${minutes} минуттан астам жауап жоқ:\n` +
      leads.map((l) => `• ${l.name} ${l.phone} — ${l.manager?.name ?? "тағайындалмаған"}`).join("\n"),
  );
  return leads.length;
}

const consultText = (when: string) =>
  `Белес клиникасы: ${when} консультацияға жазылғансыз.\n1 — растаймын, 2 — ауыстыру керек.\n` +
  `Клиника Белес: вы записаны на консультацию ${when}. 1 — подтверждаю, 2 — перенести.`;

/**
 * 2) Конс туралы үнемді еске салу (lib/whatsapp.ts → decideReminder):
 *  - тегін 24 сағаттық терезе ашық болса — тегін мәтін;
 *  - клиент «1» деп растап қойса — ақылы еске салу жіберілмейді;
 *  - тек расталмаған және терезе жабық болса — бір ақылы үлгі хабарлама.
 * WhatsApp қосылмаған болса — SMS (бар болса).
 */
export async function sendReminders(now = new Date()) {
  const hoursBefore = Number(process.env.REMINDER_HOURS || 24);
  const stats = { free: 0, paid: 0, skipped: 0 };
  const leads = await db.lead.findMany({
    where: { status: "BOOKED", consultAt: { gt: now, lte: new Date(now.getTime() + hoursBefore * 3600_000) } },
  });
  for (const l of leads) {
    if (l.phone.startsWith("ig:")) continue;
    const when = `${dateOnly(l.consultAt!)} ${time(l.consultAt!)}`;
    const d = decideReminder({
      now,
      startAt: l.consultAt!,
      status: l.consultConfirmedAt ? "CONFIRMED" : "BOOKED",
      lastInboundAt: await lastInboundAt(l.phone),
      mainSent: l.remindMainSent,
      sameDaySent: l.remindSameDaySent,
      hoursBefore,
    });
    const upd: { remindMainSent?: boolean; remindSameDaySent?: boolean } = {};

    if (d.main) {
      upd.remindMainSent = true;
      if (d.main === "free") {
        await sendText(l.phone, consultText(when));
        stats.free++;
      } else if (d.main === "paid") {
        if (waConfigured()) await sendTemplate(l.phone, TEMPLATES.reminder(), [l.name, when], `[Үлгі] ${consultText(when)}`);
        else await sendSms(l.phone, consultText(when));
        stats.paid++;
      } else stats.skipped++;
    }
    if (d.sameDay) {
      upd.remindSameDaySent = true;
      if (d.sameDay === "free" && !d.main) {
        await sendText(l.phone, `Белес клиникасы: бүгін ${time(l.consultAt!)}-да күтеміз. / Ждём вас сегодня в ${time(l.consultAt!)}.`);
        stats.free++;
      } else stats.skipped++;
    }
    if (Object.keys(upd).length) await db.lead.update({ where: { id: l.id }, data: upd });
  }
  return stats;
}

/** Конс жазылған сәтте растау сұрау — тек тегін терезе ашық болса (ақылы жібермейміз). */
export async function requestConfirmation(leadId: number) {
  const l = await db.lead.findUnique({ where: { id: leadId } });
  if (!l?.consultAt || l.phone.startsWith("ig:") || !(await isWindowOpenFor(l.phone))) return false;
  const r = await sendText(l.phone, consultText(`${dateOnly(l.consultAt)} ${time(l.consultAt)}`));
  return r.ok || r.status === "offline";
}

/** 3) Келесі хабарласу уақыты келген өтінімдер бойынша тапсырма. */
export async function callbackTasks(now = new Date()) {
  const leads = await db.lead.findMany({
    where: { nextContactAt: { lte: now }, managerId: { not: null }, status: { in: ["NEW", "CONTACTED", "NO_ANSWER", "BOOKED", "ARRIVED"] } },
  });
  for (const l of leads) {
    await ensureTask({
      refKey: `callback:${l.id}:${l.nextContactAt!.toISOString()}`,
      kind: "CALLBACK",
      title: `Қайта хабарласу: ${l.name} (${l.phone})`,
      assigneeId: l.managerId!,
      dueAt: l.nextContactAt!,
      leadId: l.id,
    });
  }
  return leads.length;
}

/** 4) Конс уақыты өтіп кетті, бірақ статус әлі «Конс» — менеджерге «келді ме?» тапсырмасы. */
export async function consultPassedTasks(now = new Date()) {
  const leads = await db.lead.findMany({ where: { status: "BOOKED", consultAt: { lt: new Date(now.getTime() - 3600_000) } } });
  let n = 0;
  for (const l of leads) {
    const assignee = await responsibleFor(l);
    if (!assignee) continue;
    const key = `consult-passed:${l.id}:${l.consultAt!.toISOString()}`;
    if (await db.task.findUnique({ where: { refKey: key } })) continue;
    await ensureTask({
      refKey: key,
      kind: "CONSULT_PASSED",
      title: `Конс өтті (${dateOnly(l.consultAt!)} ${time(l.consultAt!)}): ${l.name} — келді ме? Статусын жаңартыңыз`,
      assigneeId: assignee,
      dueAt: now,
      leadId: l.id,
    });
    n++;
  }
  return n;
}

/** Күнделікті есеп мәтіні (бас менеджерге). */
export async function buildDailyReport(now = new Date()) {
  const from = startOfDay(now);
  const to = addDays(from, 1);
  const mFrom = startOfMonth(now);
  const [leads, consultsToday, paidToday, monthRevenue, managers, plan] = await Promise.all([
    db.lead.findMany({ where: { createdAt: { gte: from, lt: to }, status: { not: "SPAM" } } }),
    db.lead.findMany({ where: { consultAt: { gte: from, lt: to } }, select: { status: true } }),
    db.lead.findMany({ where: { paidAt: { gte: from, lt: to } }, select: { amount: true, managerId: true } }),
    db.lead.aggregate({ _sum: { amount: true }, where: { paidAt: { gte: mFrom, lt: to } } }),
    db.user.findMany({ where: { role: "MANAGER", active: true } }),
    db.monthlyPlan.findFirst({ where: { month: monthKey(now), managerId: null } }),
  ]);
  const f = funnel(leads);
  const arrived = consultsToday.filter((c) => c.status === "ARRIVED" || c.status === "PAID").length;
  const monthRev = monthRevenue._sum.amount ?? 0;
  const todayRev = paidToday.reduce((s, x) => s + (x.amount ?? 0), 0);

  const rows = managers
    .map((m) => {
      const ml = leads.filter((l) => l.managerId === m.id);
      const rev = paidToday.filter((p) => p.managerId === m.id).reduce((s, x) => s + (x.amount ?? 0), 0);
      return { name: m.name, leads: ml.length, booked: funnel(ml).booked, rev };
    })
    .sort((a, b) => b.rev - a.rev || b.booked - a.booked);

  return [
    `📊 <b>Белес — күндік есеп ${dateOnly(now)}</b>`,
    `Өтінімдер: ${f.total} (конс-қа жазылды ${f.booked}, отказ ${f.lost})`,
    `Бүгінгі конс: ${consultsToday.length} (келді ${arrived})`,
    `Бүгін емге төлегендер: ${paidToday.length} · ${money(todayRev)}`,
    `Ай түсімі: ${money(monthRev)}${plan?.revenue ? ` / ${money(plan.revenue)} (${pct(monthRev, plan.revenue)}%)` : ""}`,
    `WhatsApp ақылы хабарламалар (ай): ${await paidThisMonth(now)}`,
    ``,
    `<b>Менеджерлер:</b>`,
    ...rows.map((r, i) => `${i + 1}. ${r.name}: ${r.leads} лид, ${r.booked} конс, ${money(r.rev)}`),
  ].join("\n");
}

export async function sendDailyReport(now = new Date()) {
  return sendTelegram(await buildDailyReport(now));
}

/** Жиі (5 минут сайын) іске қосылатын автоматтандырулар. */
export async function runFrequent(now = new Date()) {
  const res = {
    escalated: await escalateUnanswered(now),
    reminders: await sendReminders(now),
    callbacks: await callbackTasks(now),
    consultPassed: await consultPassedTasks(now),
  };
  if (res.escalated || res.reminders.free || res.reminders.paid) await audit(null, "Automation", null, "run", res);
  return res;
}

/** WhatsApp-тан клиент жауабы: «1» — растау, «2» — ауыстыру. true — өңделді. */
export async function handleClientReply(phone: string, text: string) {
  const answer = text.trim();
  if (answer !== "1" && answer !== "2") return false;
  const lead = await db.lead.findFirst({
    where: { phone, status: "BOOKED", consultAt: { gt: new Date() } },
    orderBy: { consultAt: "asc" },
  });
  if (!lead) return false;
  const when = `${dateOnly(lead.consultAt!)} ${time(lead.consultAt!)}`;
  if (answer === "1") {
    await db.lead.update({ where: { id: lead.id }, data: { consultConfirmedAt: new Date() } });
    await db.leadActivity.create({ data: { leadId: lead.id, type: "SYSTEM", text: `Клиент конс-ты растады (${when})` } });
    // Клиент жаңа ғана жазды — терезе ашық, жауап тегін
    await sendText(phone, `Рахмет! ${when} консультацияңыз расталды. / Спасибо, запись подтверждена.`);
  } else {
    const assignee = await responsibleFor(lead);
    if (assignee)
      await ensureTask({
        refKey: `reschedule:${lead.id}:${lead.consultAt!.toISOString()}`,
        kind: "RESCHEDULE",
        title: `Конс уақытын ауыстыруды сұрады: ${lead.name} (${lead.phone}), ${when}`,
        assigneeId: assignee,
        dueAt: new Date(),
        leadId: lead.id,
      });
    await db.leadActivity.create({ data: { leadId: lead.id, type: "SYSTEM", text: `Клиент конс уақытын ауыстыруды сұрады (${when})` } });
    await sendText(phone, "Түсіндік, менеджер жақын арада хабарласып, ыңғайлы уақытты ұсынады. / Менеджер свяжется с вами для переноса.");
  }
  return true;
}
