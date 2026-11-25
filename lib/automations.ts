import { db } from "./db";
import { sendTelegram, sendToPatient } from "./notify";
import { decideReminder, lastInboundAt, sendText, sendTemplate, waConfigured, TEMPLATES, isWindowOpenFor, paidThisMonth } from "./whatsapp";
import { audit } from "./audit";
import { addDays, money, monthKey, startOfDay, startOfMonth, time, dateOnly, pct } from "./format";
import { funnel } from "./stats";

/** refKey бойынша бір рет қана тапсырма құрады (қайталанбайды). */
export async function ensureTask(data: {
  refKey: string;
  title: string;
  kind: string;
  assigneeId: number;
  dueAt: Date;
  leadId?: number | null;
  patientId?: number | null;
}) {
  const exists = await db.task.findUnique({ where: { refKey: data.refKey } });
  if (exists) return exists;
  return db.task.create({ data });
}

/** Тапсырма кімге: пациенттің соңғы өтініміндегі менеджер → бас менеджер. */
async function responsibleFor(patientId: number) {
  const lead = await db.lead.findFirst({
    where: { patientId, managerId: { not: null } },
    orderBy: { createdAt: "desc" },
  });
  if (lead?.managerId) return lead.managerId;
  const head = await db.user.findFirst({ where: { role: "HEAD_MANAGER", active: true } });
  return head?.id ?? null;
}

/** Қабылдау статусы өзгергенде шақырылады. */
export async function onAppointmentStatus(apptId: number, status: string) {
  const a = await db.appointment.findUnique({ where: { id: apptId }, include: { patient: true, course: true } });
  if (!a) return;
  const assignee = await responsibleFor(a.patientId);

  if (status === "NO_SHOW" && assignee) {
    await ensureTask({
      refKey: `noshow:${a.id}`,
      kind: "NO_SHOW",
      title: `Келмеді: ${a.patient.fullName} (${a.patient.phone}) — қайта жазу`,
      assigneeId: assignee,
      dueAt: new Date(),
      patientId: a.patientId,
    });
  }

  if (status === "ARRIVED") {
    // Өтінім статусын «Келді»-ге көтеру
    await db.lead.updateMany({
      where: { patientId: a.patientId, status: { in: ["NEW", "CONTACTED", "NO_ANSWER", "BOOKED"] } },
      data: { status: "ARRIVED" },
    });
    // Курс сеанстарын санау
    if (a.course) {
      const done = await db.appointment.count({ where: { courseId: a.course.id, status: "ARRIVED" } });
      const finished = done >= a.course.totalSessions;
      await db.treatmentCourse.update({
        where: { id: a.course.id },
        data: { doneSessions: done, status: finished ? "DONE" : "ACTIVE", finishedAt: finished ? new Date() : null },
      });
      const left = a.course.totalSessions - done;
      if (left === 2 && assignee) {
        await ensureTask({
          refKey: `course-ending:${a.course.id}`,
          kind: "COURSE_ENDING",
          title: `Курс аяқталуда (2 сеанс қалды): ${a.patient.fullName} — жалғастыруды ұсыну`,
          assigneeId: assignee,
          dueAt: new Date(),
          patientId: a.patientId,
        });
      }
    }
  }
}

/** 1) Жауапсыз өтінімдерді бас менеджерге эскалациялау. */
export async function escalateUnanswered(now = new Date()) {
  const minutes = Number(process.env.ESCALATION_MINUTES || 15);
  const leads = await db.lead.findMany({
    where: {
      status: "NEW",
      firstResponseAt: null,
      escalatedAt: null,
      createdAt: { lt: new Date(now.getTime() - minutes * 60000) },
    },
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

const reminderText = (when: string, doctor: string) =>
  `Белес клиникасы: ${when} қабылдауға жазылғансыз (${doctor}).\n1 — растаймын, 2 — ауыстыру керек.\n` +
  `Клиника Белес: вы записаны на ${when}. 1 — подтверждаю, 2 — перенести.`;

/**
 * 2) Үнемді еске салу (lib/whatsapp.ts → decideReminder):
 *  - тегін 24 сағаттық терезе ашық болса — тегін мәтін;
 *  - пациент «1» деп растап қойса — ақылы еске салу жіберілмейді;
 *  - тек расталмаған және терезе жабық болса — бір ақылы үлгі хабарлама.
 * WhatsApp қосылмаған болса — SMS (бар болса) арқылы негізгі еске салу.
 */
export async function sendReminders(now = new Date()) {
  const hoursBefore = Number(process.env.REMINDER_HOURS || 24);
  const stats = { free: 0, paid: 0, skipped: 0 };
  const appts = await db.appointment.findMany({
    where: { status: { in: ["BOOKED", "CONFIRMED"] }, startAt: { gt: now, lte: new Date(now.getTime() + hoursBefore * 3600_000) } },
    include: { patient: true, doctor: true },
  });
  for (const a of appts) {
    const when = `${dateOnly(a.startAt)} ${time(a.startAt)}`;
    const d = decideReminder({
      now,
      startAt: a.startAt,
      status: a.status,
      lastInboundAt: await lastInboundAt(a.patient.phone),
      mainSent: a.remind24Sent,
      sameDaySent: a.remind2Sent,
      hoursBefore,
    });
    const upd: { remind24Sent?: boolean; remind2Sent?: boolean } = {};

    if (d.main) {
      upd.remind24Sent = true;
      if (d.main === "free") {
        await sendText(a.patient.phone, reminderText(when, a.doctor.name));
        stats.free++;
      } else if (d.main === "paid") {
        if (waConfigured()) {
          await sendTemplate(a.patient.phone, TEMPLATES.reminder(), [a.patient.fullName, when, a.doctor.name], `[Үлгі] ${reminderText(when, a.doctor.name)}`);
        } else {
          await sendToPatient(a.patient.phone, reminderText(when, a.doctor.name)); // SMS fallback
        }
        stats.paid++;
      } else stats.skipped++;
    }
    if (d.sameDay) {
      upd.remind2Sent = true;
      if (d.sameDay === "free" && !d.main) {
        await sendText(a.patient.phone, `Белес клиникасы: бүгін ${time(a.startAt)}-да күтеміз (${a.doctor.name}). / Ждём вас сегодня в ${time(a.startAt)}.`);
        stats.free++;
      } else stats.skipped++;
    }
    if (Object.keys(upd).length) await db.appointment.update({ where: { id: a.id }, data: upd });
  }
  return stats;
}

/** Жазылған сәтте растау сұрау — тек тегін терезе ашық болса (ақылы жібермейміз). */
export async function requestConfirmation(apptId: number) {
  const a = await db.appointment.findUnique({ where: { id: apptId }, include: { patient: true, doctor: true } });
  if (!a || !(await isWindowOpenFor(a.patient.phone))) return false;
  const when = `${dateOnly(a.startAt)} ${time(a.startAt)}`;
  const r = await sendText(a.patient.phone, reminderText(when, a.doctor.name));
  return r.ok || r.status === "offline";
}

/** 3) Курс аяқталғаннан 30 күн өткенде — «жағдайын сұрау» тапсырмасы. */
export async function followUps(now = new Date()) {
  const courses = await db.treatmentCourse.findMany({
    where: { status: "DONE", finishedAt: { lte: addDays(now, -30) } },
    include: { patient: true },
  });
  let n = 0;
  for (const c of courses) {
    const assignee = await responsibleFor(c.patientId);
    if (!assignee) continue;
    const before = await db.task.count({ where: { refKey: `followup30:${c.id}` } });
    await ensureTask({
      refKey: `followup30:${c.id}`,
      kind: "FOLLOWUP_30",
      title: `Курстан 30 күн өтті: ${c.patient.fullName} (${c.patient.phone}) — жағдайын сұрау`,
      assigneeId: assignee,
      dueAt: now,
      patientId: c.patientId,
    });
    if (!before) n++;
  }
  return n;
}

/** 4) Келесі хабарласу уақыты келген өтінімдер бойынша тапсырма. */
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

/** Күнделікті есеп мәтіні (бас менеджерге). */
export async function buildDailyReport(now = new Date()) {
  const from = startOfDay(now);
  const to = addDays(from, 1);
  const mFrom = startOfMonth(now);
  const [leads, appts, payments, monthPayments, managers, plan] = await Promise.all([
    db.lead.findMany({ where: { createdAt: { gte: from, lt: to }, status: { not: "SPAM" } } }),
    db.appointment.findMany({ where: { startAt: { gte: from, lt: to } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: from, lt: to } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: mFrom, lt: to } } }),
    db.user.findMany({ where: { role: "MANAGER", active: true } }),
    db.monthlyPlan.findFirst({ where: { month: monthKey(now), managerId: null } }),
  ]);
  const f = funnel(leads);
  const arrived = appts.filter((a) => a.status === "ARRIVED").length;
  const noShow = appts.filter((a) => a.status === "NO_SHOW").length;
  const monthRev = monthPayments._sum.amount ?? 0;

  const rows = await Promise.all(
    managers.map(async (m) => {
      const rev = await db.payment.aggregate({ _sum: { amount: true }, where: { managerId: m.id, createdAt: { gte: from, lt: to } } });
      const ml = leads.filter((l) => l.managerId === m.id);
      return { name: m.name, leads: ml.length, booked: funnel(ml).booked, rev: rev._sum.amount ?? 0 };
    }),
  );
  rows.sort((a, b) => b.rev - a.rev);

  return [
    `📊 <b>Белес — күндік есеп ${dateOnly(now)}</b>`,
    `Өтінімдер: ${f.total} (жазылды ${f.booked}, бас тартты ${f.lost})`,
    `Қабылдау: ${appts.length} (келді ${arrived}, келмеді ${noShow})`,
    `Бүгінгі түсім: ${money(payments._sum.amount ?? 0)}`,
    `WhatsApp ақылы хабарламалар (ай): ${await paidThisMonth(now)}`,
    `Ай түсімі: ${money(monthRev)}${plan?.revenue ? ` / ${money(plan.revenue)} (${pct(monthRev, plan.revenue)}%)` : ""}`,
    ``,
    `<b>Менеджерлер:</b>`,
    ...rows.map((r, i) => `${i + 1}. ${r.name}: ${r.leads} лид, ${r.booked} жазылу, ${money(r.rev)}`),
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
    followUps: await followUps(now),
  };
  if (res.escalated || res.reminders.free || res.reminders.paid) await audit(null, "Automation", null, "run", res);
  return res;
}

/** WhatsApp-тан пациент жауабы: «1» — растау, «2» — ауыстыру. true — өңделді. */
export async function handlePatientReply(phone: string, text: string) {
  const answer = text.trim();
  if (answer !== "1" && answer !== "2") return false;
  const patient = await db.patient.findUnique({ where: { phone } });
  if (!patient) return false;
  const appt = await db.appointment.findFirst({
    where: { patientId: patient.id, status: { in: ["BOOKED", "CONFIRMED"] }, startAt: { gt: new Date() } },
    orderBy: { startAt: "asc" },
  });
  if (!appt) return false;
  if (answer === "1") {
    await db.appointment.update({ where: { id: appt.id }, data: { status: "CONFIRMED" } });
    await audit(null, "Appointment", appt.id, "confirmed_by_patient");
    // Пациент жаңа ғана жазды — терезе ашық, жауап тегін
    await sendText(phone, `Рахмет! ${dateOnly(appt.startAt)} ${time(appt.startAt)} қабылдауыңыз расталды. / Спасибо, запись подтверждена.`);
  } else {
    const assignee = await responsibleFor(patient.id);
    if (assignee)
      await ensureTask({
        refKey: `reschedule:${appt.id}`,
        kind: "RESCHEDULE",
        title: `Ауыстыруды сұрады: ${patient.fullName} (${patient.phone}), ${dateOnly(appt.startAt)} ${time(appt.startAt)}`,
        assigneeId: assignee,
        dueAt: new Date(),
        patientId: patient.id,
      });
    await audit(null, "Appointment", appt.id, "reschedule_requested");
    await sendText(phone, "Түсіндік, менеджер жақын арада хабарласып, ыңғайлы уақытты ұсынады. / Менеджер свяжется с вами для переноса.");
  }
  return true;
}
