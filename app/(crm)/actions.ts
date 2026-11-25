"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireUser, isHead, createSession, type CurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createIncomingLead, autoAssignManager } from "@/lib/leads";
import { normalizePhone } from "@/lib/phone";
import { runFrequent, sendDailyReport, requestConfirmation } from "@/lib/automations";
import { passwordProblem } from "@/lib/security";
import { dateOnly, time } from "@/lib/format";
import { LEAD_STATUSES, ROLES, CLOSED_LEAD_STATUSES, NO_ANSWER_RETRY_HOURS } from "@/lib/constants";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : Number(v);
};
const date = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v ? new Date(v) : null;
};

async function loadLeadFor(user: CurrentUser, id: number) {
  const lead = await db.lead.findUnique({ where: { id } });
  if (!lead) throw new Error("Lead not found");
  if (!isHead(user) && lead.managerId !== user.id) throw new Error("Forbidden");
  return lead;
}
async function requireStaff() {
  return requireUser(["HEAD_MANAGER", "MANAGER"]);
}
async function requireHead() {
  return requireUser(["HEAD_MANAGER"]);
}

/* ---------------- Өтінімдер ---------------- */

export async function createLead(fd: FormData) {
  const u = await requireStaff();
  const managerRaw = str(fd, "managerId");
  // Менеджер өзі құрса — өзіне; бас менеджер таңдай алады, «auto» — автобөлу
  const managerId = !isHead(u) ? u.id : managerRaw === "auto" || managerRaw === "" ? null : Number(managerRaw);
  const { lead, duplicate } = await createIncomingLead({
    name: str(fd, "name"),
    phone: str(fd, "phone"),
    source: str(fd, "source"),
    complaint: str(fd, "complaint"),
    comment: str(fd, "comment"),
    managerId,
    createdBy: u.id,
  });
  revalidatePath("/leads");
  redirect(`/leads/${lead.id}${duplicate ? "?dup=1" : ""}`);
}

async function applyLeadStatus(
  u: CurrentUser,
  leadId: number,
  status: string,
  extra: { lostReason?: string | null; amount?: number | null } = {},
) {
  const lead = await loadLeadFor(u, leadId);
  if (!(LEAD_STATUSES as readonly string[]).includes(status) || lead.status === status) return lead;
  await db.lead.update({
    where: { id: leadId },
    data: {
      status,
      // «Емге төледі» — сома мен күні түсім есебіне кіреді
      ...(status === "PAID"
        ? { paidAt: new Date(), amount: extra.amount ?? lead.amount }
        : lead.status === "PAID"
          ? { paidAt: null }
          : {}),
      lostReason: status === "LOST" ? extra.lostReason || lead.lostReason || "OTHER" : null,
      firstResponseAt: lead.firstResponseAt ?? (status !== "NEW" ? new Date() : null),
      // «Не отвечает» → N сағаттан кейін қайта хабарласу автоматты қойылады
      ...(status === "NO_ANSWER" && (!lead.nextContactAt || lead.nextContactAt < new Date())
        ? { nextContactAt: new Date(Date.now() + NO_ANSWER_RETRY_HOURS * 3600_000) }
        : {}),
    },
  });
  await db.leadActivity.create({ data: { leadId, userId: u.id, type: "STATUS", text: `${lead.status} → ${status}` } });
  await audit(u.id, "Lead", leadId, "status", { from: lead.status, to: status });
  return lead;
}

const amountOf = (fd: FormData) => {
  const v = num(fd, "amount");
  return v !== null && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
};

/** Конс күнін қою/ауыстыру: статус «Конс»-қа көтеріледі, еске салулар қайта қосылады, тегін болса растау сұралады. */
async function applyConsult(u: CurrentUser, leadId: number, consultAt: Date | null) {
  if (consultAt && isNaN(consultAt.getTime())) return;
  const lead = await loadLeadFor(u, leadId);
  await db.lead.update({
    where: { id: leadId },
    data: { consultAt, consultConfirmedAt: null, remindMainSent: false, remindSameDaySent: false },
  });
  await db.leadActivity.create({
    data: { leadId, userId: u.id, type: "SYSTEM", text: consultAt ? `Конс: ${dateOnly(consultAt)} ${time(consultAt)}` : "Конс күні алынды" },
  });
  if (consultAt && ["NEW", "CONTACTED", "NO_ANSWER"].includes(lead.status)) await applyLeadStatus(u, leadId, "BOOKED");
  if (consultAt && consultAt > new Date()) await requestConfirmation(leadId); // тек тегін терезе ашық болса
}

export async function setConsult(fd: FormData) {
  const u = await requireStaff();
  const id = Number(str(fd, "id"));
  await applyConsult(u, id, date(fd, "consultAt"));
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
  revalidatePath("/");
}

export async function moveLead(fd: FormData) {
  const u = await requireStaff();
  await applyLeadStatus(u, Number(str(fd, "id")), str(fd, "status"), { lostReason: str(fd, "lostReason") || null, amount: amountOf(fd) });
  revalidatePath("/leads");
  revalidatePath("/");
  revalidatePath(`/leads/${str(fd, "id")}`);
}

export async function updateLead(fd: FormData) {
  const u = await requireStaff();
  const id = Number(str(fd, "id"));
  const lead = await loadLeadFor(u, id);
  await db.lead.update({
    where: { id },
    data: {
      name: str(fd, "name") || lead.name,
      phone: str(fd, "phone") ? normalizePhone(str(fd, "phone")) : lead.phone,
      complaint: str(fd, "complaint") || lead.complaint,
      source: str(fd, "source") || lead.source,
      comment: str(fd, "comment") || null,
      nextContactAt: date(fd, "nextContactAt"),
      ...(lead.status === "PAID" && amountOf(fd) !== null ? { amount: amountOf(fd) } : {}),
    },
  });
  const consultAt = date(fd, "consultAt");
  if ((consultAt?.getTime() ?? null) !== (lead.consultAt?.getTime() ?? null)) await applyConsult(u, id, consultAt);
  // Статус — тек менеджер формада шынымен өзгертсе (әйтпесе конс қойылғандағы «Конс» статусын ескі мән басып кетер еді)
  const formStatus = str(fd, "status");
  if (formStatus && formStatus !== lead.status) await applyLeadStatus(u, id, formStatus, { lostReason: str(fd, "lostReason") || null, amount: amountOf(fd) });
  await audit(u.id, "Lead", id, "update");
  revalidatePath(`/leads/${id}`);
}

export async function addLeadActivity(fd: FormData) {
  const u = await requireStaff();
  const id = Number(str(fd, "id"));
  const lead = await loadLeadFor(u, id);
  const type = str(fd, "type") || "NOTE";
  const text = str(fd, "text");
  if (!text) return;
  await db.leadActivity.create({ data: { leadId: id, userId: u.id, type, text } });
  if (!lead.firstResponseAt && (type === "CALL" || type === "MESSAGE")) {
    await db.lead.update({
      where: { id },
      data: { firstResponseAt: new Date(), status: lead.status === "NEW" || lead.status === "NO_ANSWER" ? "CONTACTED" : lead.status },
    });
  }
  revalidatePath(`/leads/${id}`);
}

export async function reassignLead(fd: FormData) {
  const u = await requireHead();
  const id = Number(str(fd, "id"));
  const managerId = num(fd, "managerId");
  const lead = await db.lead.findUniqueOrThrow({ where: { id } });
  await db.lead.update({ where: { id }, data: { managerId } });
  const m = managerId ? await db.user.findUnique({ where: { id: managerId } }) : null;
  await db.leadActivity.create({ data: { leadId: id, userId: u.id, type: "SYSTEM", text: `Менеджер ауысты → ${m?.name ?? "—"}` } });
  await audit(u.id, "Lead", id, "reassign", { from: lead.managerId, to: managerId });
  revalidatePath("/");
  revalidatePath("/leads");
  revalidatePath(`/leads/${id}`);
}

export async function autoAssignUnassigned() {
  const u = await requireHead();
  const leads = await db.lead.findMany({ where: { managerId: null, status: { notIn: CLOSED_LEAD_STATUSES } }, orderBy: { createdAt: "asc" } });
  for (const l of leads) {
    const m = await autoAssignManager();
    if (!m) break;
    await db.lead.update({ where: { id: l.id }, data: { managerId: m } });
  }
  await audit(u.id, "Lead", null, "auto_assign", { count: leads.length });
  revalidatePath("/");
  revalidatePath("/leads");
}

/* ---------------- Тапсырмалар ---------------- */

export async function createTask(fd: FormData) {
  const u = await requireUser();
  const assigneeId = isHead(u) ? Number(str(fd, "assigneeId") || u.id) : u.id;
  await db.task.create({
    data: {
      title: str(fd, "title").slice(0, 500),
      assigneeId,
      dueAt: date(fd, "dueAt") ?? new Date(),
      leadId: isHead(u) ? num(fd, "leadId") : null,
    },
  });
  revalidatePath("/tasks");
  revalidatePath("/");
}

export async function toggleTask(fd: FormData) {
  const u = await requireUser();
  const id = Number(str(fd, "id"));
  const task = await db.task.findUniqueOrThrow({ where: { id } });
  if (!isHead(u) && task.assigneeId !== u.id) return;
  await db.task.update({ where: { id }, data: { done: !task.done } });
  revalidatePath("/tasks");
  revalidatePath("/");
}

/* ---------------- Баптаулар (бас менеджер) ---------------- */

export async function saveUser(fd: FormData) {
  const u = await requireHead();
  const id = num(fd, "id");
  const role = str(fd, "role");
  if (!(ROLES as readonly string[]).includes(role)) return;
  const password = String(fd.get("password") ?? "");
  if ((password || !id) && passwordProblem(password)) redirect("/settings?pw=weak");
  const data: { name: string; login: string; role: string; active: boolean; passwordHash?: string } = {
    name: str(fd, "name"),
    login: str(fd, "login"),
    role,
    active: id ? fd.get("active") === "on" : true,
  };
  // Бас менеджер өзін өшіріп не рөлін түсіріп, жүйеден құлыпталып қалмауы үшін
  if (id === u.id) {
    data.active = true;
    data.role = "HEAD_MANAGER";
  }
  if (password) data.passwordHash = await bcrypt.hash(password, 12);
  if (id) {
    const before = await db.user.findUniqueOrThrow({ where: { id } });
    // Құпиясөз, рөл не белсенділік өзгерсе — барлық ашық сессиялар жабылады
    const revoke = !!password || before.role !== data.role || before.active !== data.active;
    await db.user.update({ where: { id }, data: { ...data, ...(revoke ? { sessionVersion: { increment: 1 } } : {}) } });
    if (id === u.id && password) {
      const me = await db.user.findUniqueOrThrow({ where: { id } });
      await createSession(me.id, me.role, me.sessionVersion);
    }
  } else if (data.passwordHash) await db.user.create({ data: { ...data, passwordHash: data.passwordHash } });
  await audit(u.id, "User", id, id ? "update" : "create", { login: data.login, role });
  revalidatePath("/settings");
}

export async function savePlan(fd: FormData) {
  const u = await requireHead();
  const month = str(fd, "month");
  const managerId = num(fd, "managerId");
  const data = { leads: Number(str(fd, "leads") || 0), bookings: Number(str(fd, "bookings") || 0), revenue: Number(str(fd, "revenue") || 0) };
  const existing = await db.monthlyPlan.findFirst({ where: { month, managerId } });
  if (existing) await db.monthlyPlan.update({ where: { id: existing.id }, data });
  else await db.monthlyPlan.create({ data: { month, managerId, ...data } });
  await audit(u.id, "MonthlyPlan", null, "save", { month, managerId, ...data });
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function runAutomationsNow() {
  const u = await requireHead();
  const res = await runFrequent();
  await sendDailyReport();
  await audit(u.id, "Automation", null, "manual_run", res);
  revalidatePath("/");
}
