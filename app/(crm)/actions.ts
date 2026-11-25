"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { db } from "@/lib/db";
import { requireUser, isHead, type CurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createIncomingLead, autoAssignManager } from "@/lib/leads";
import { normalizePhone } from "@/lib/phone";
import { findConflict } from "@/lib/schedule";
import { onAppointmentStatus, runFrequent, sendDailyReport } from "@/lib/automations";
import { LEAD_STATUSES, APPT_STATUSES, PAYMENT_METHODS, ROLES } from "@/lib/constants";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === "" ? null : Number(v);
};
const date = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v ? new Date(v) : null;
};
const back = (fd: FormData, fallback: string) => {
  const b = str(fd, "back");
  return b.startsWith("/") ? b : fallback;
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

async function applyLeadStatus(u: CurrentUser, leadId: number, status: string, extra: { lostReason?: string | null } = {}) {
  const lead = await loadLeadFor(u, leadId);
  if (!(LEAD_STATUSES as readonly string[]).includes(status) || lead.status === status) return lead;
  await db.lead.update({
    where: { id: leadId },
    data: {
      status,
      lostReason: status === "LOST" ? extra.lostReason || lead.lostReason || "OTHER" : null,
      firstResponseAt: lead.firstResponseAt ?? (status !== "NEW" ? new Date() : null),
    },
  });
  await db.leadActivity.create({ data: { leadId, userId: u.id, type: "STATUS", text: `${lead.status} → ${status}` } });
  await audit(u.id, "Lead", leadId, "status", { from: lead.status, to: status });
  return lead;
}

export async function moveLead(fd: FormData) {
  const u = await requireStaff();
  await applyLeadStatus(u, Number(str(fd, "id")), str(fd, "status"), { lostReason: str(fd, "lostReason") || null });
  revalidatePath("/leads");
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
    },
  });
  if (str(fd, "status")) await applyLeadStatus(u, id, str(fd, "status"), { lostReason: str(fd, "lostReason") || null });
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
      data: { firstResponseAt: new Date(), status: lead.status === "NEW" ? "CONTACTED" : lead.status },
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
  const leads = await db.lead.findMany({ where: { managerId: null, status: { notIn: ["PAID", "LOST"] } }, orderBy: { createdAt: "asc" } });
  for (const l of leads) {
    const m = await autoAssignManager();
    if (!m) break;
    await db.lead.update({ where: { id: l.id }, data: { managerId: m } });
  }
  await audit(u.id, "Lead", null, "auto_assign", { count: leads.length });
  revalidatePath("/");
  revalidatePath("/leads");
}

export async function convertLead(fd: FormData) {
  const u = await requireStaff();
  const id = Number(str(fd, "id"));
  const lead = await loadLeadFor(u, id);
  let patientId = lead.patientId;
  if (!patientId) {
    const existing = await db.patient.findUnique({ where: { phone: lead.phone } });
    const p =
      existing ??
      (await db.patient.create({ data: { fullName: lead.name, phone: lead.phone, diagnosis: lead.complaint } }));
    patientId = p.id;
    await db.lead.update({ where: { id }, data: { patientId } });
    await audit(u.id, "Patient", p.id, existing ? "link" : "create", { fromLead: id });
  }
  redirect(`/patients/${patientId}`);
}

/* ---------------- Пациенттер ---------------- */

export async function savePatient(fd: FormData) {
  const u = await requireUser();
  const id = num(fd, "id");
  const data = {
    fullName: str(fd, "fullName"),
    phone: normalizePhone(str(fd, "phone")),
    iin: str(fd, "iin") || null,
    birthDate: date(fd, "birthDate"),
    gender: str(fd, "gender") || null,
    diagnosis: str(fd, "diagnosis") || null,
    hasMri: fd.get("hasMri") === "on",
    notes: str(fd, "notes") || null,
  };
  const dup = await db.patient.findUnique({ where: { phone: data.phone } });
  if (dup && dup.id !== id) redirect(`/patients/${dup.id}?dup=1`);
  const p = id ? await db.patient.update({ where: { id }, data }) : await db.patient.create({ data });
  await audit(u.id, "Patient", p.id, id ? "update" : "create");
  revalidatePath("/patients");
  redirect(`/patients/${p.id}`);
}

export async function createCourse(fd: FormData) {
  const u = await requireUser();
  const patientId = Number(str(fd, "patientId"));
  const c = await db.treatmentCourse.create({
    data: {
      patientId,
      title: str(fd, "title"),
      totalSessions: Number(str(fd, "totalSessions") || 10),
      price: Number(str(fd, "price") || 0),
      doctorId: num(fd, "doctorId"),
    },
  });
  await audit(u.id, "Course", c.id, "create", { patientId, price: c.price });
  revalidatePath(`/patients/${patientId}`);
}

export async function setCourseStatus(fd: FormData) {
  const u = await requireUser();
  const id = Number(str(fd, "id"));
  const status = str(fd, "status");
  const c = await db.treatmentCourse.update({
    where: { id },
    data: { status, finishedAt: status === "DONE" ? new Date() : null },
  });
  await audit(u.id, "Course", id, "status", status);
  revalidatePath(`/patients/${c.patientId}`);
}

export async function addMedicalNote(fd: FormData) {
  const u = await requireUser();
  const patientId = Number(str(fd, "patientId"));
  const text = str(fd, "text");
  if (!text) return;
  await db.medicalNote.create({ data: { patientId, authorId: u.id, text, diagnosis: str(fd, "diagnosis") || null } });
  if (str(fd, "diagnosis")) await db.patient.update({ where: { id: patientId }, data: { diagnosis: str(fd, "diagnosis") } });
  revalidatePath(`/patients/${patientId}`);
}

export async function uploadFile(fd: FormData) {
  const u = await requireUser();
  const patientId = Number(str(fd, "patientId"));
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return;
  const dir = path.join(process.cwd(), "uploads", String(patientId));
  await mkdir(dir, { recursive: true });
  const safe = `${Date.now()}-${file.name.replace(/[^\p{L}\p{N}._-]/gu, "_")}`;
  await writeFile(path.join(dir, safe), Buffer.from(await file.arrayBuffer()));
  await db.attachment.create({ data: { patientId, fileName: file.name, path: `${patientId}/${safe}` } });
  await audit(u.id, "Attachment", patientId, "upload", file.name);
  revalidatePath(`/patients/${patientId}`);
}

/* ---------------- Кесте ---------------- */

export async function createAppointment(fd: FormData) {
  const u = await requireUser();
  const patientId = Number(str(fd, "patientId"));
  const doctorId = Number(str(fd, "doctorId"));
  const serviceId = Number(str(fd, "serviceId"));
  const startAt = date(fd, "startAt")!;
  const courseId = num(fd, "courseId");
  const service = await db.service.findUniqueOrThrow({ where: { id: serviceId } });
  const endAt = new Date(startAt.getTime() + service.durationMin * 60000);
  const backUrl = back(fd, "/schedule");

  const sameDay = await db.appointment.findMany({
    where: {
      doctorId,
      status: { in: ["BOOKED", "CONFIRMED", "ARRIVED"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });
  if (findConflict({ startAt, endAt }, sameDay)) {
    const sep = backUrl.includes("?") ? "&" : "?";
    redirect(`${backUrl}${sep}error=conflict`);
  }

  const a = await db.appointment.create({
    data: {
      patientId,
      doctorId,
      serviceId,
      startAt,
      endAt,
      courseId,
      price: courseId ? 0 : service.price,
      comment: str(fd, "comment") || null,
      managerId: u.role === "DOCTOR" ? null : u.id,
    },
  });
  await db.lead.updateMany({
    where: { patientId, status: { in: ["NEW", "CONTACTED"] } },
    data: { status: "BOOKED", firstResponseAt: new Date() },
  });
  await audit(u.id, "Appointment", a.id, "create", { patientId, doctorId, startAt });
  revalidatePath("/schedule");
  revalidatePath(`/patients/${patientId}`);
  const clean = backUrl.replace(/[?&]error=conflict/, "");
  redirect(clean);
}

export async function setAppointmentStatus(fd: FormData) {
  const u = await requireUser();
  const id = Number(str(fd, "id"));
  const status = str(fd, "status");
  if (!(APPT_STATUSES as readonly string[]).includes(status)) return;
  const a = await db.appointment.update({ where: { id }, data: { status } });
  await audit(u.id, "Appointment", id, "status", status);
  await onAppointmentStatus(id, status);
  revalidatePath("/schedule");
  revalidatePath(`/patients/${a.patientId}`);
  revalidatePath("/");
}

/* ---------------- Касса ---------------- */

export async function createPayment(fd: FormData) {
  const u = await requireStaff();
  const patientId = Number(str(fd, "patientId"));
  const amount = Number(str(fd, "amount"));
  const method = str(fd, "method");
  if (!amount || amount <= 0 || !(PAYMENT_METHODS as readonly string[]).includes(method)) return;
  const courseId = num(fd, "courseId");
  const p = await db.payment.create({
    data: { patientId, amount, method, courseId, managerId: u.id, comment: str(fd, "comment") || null },
  });
  if (courseId) {
    await db.lead.updateMany({
      where: { patientId, status: { in: ["NEW", "CONTACTED", "BOOKED", "ARRIVED"] } },
      data: { status: "PAID" },
    });
  }
  await audit(u.id, "Payment", p.id, "create", { patientId, amount, method });
  revalidatePath("/payments");
  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/");
}

/* ---------------- Тапсырмалар ---------------- */

export async function createTask(fd: FormData) {
  const u = await requireUser();
  const assigneeId = isHead(u) ? Number(str(fd, "assigneeId") || u.id) : u.id;
  await db.task.create({
    data: {
      title: str(fd, "title"),
      assigneeId,
      dueAt: date(fd, "dueAt") ?? new Date(),
      leadId: num(fd, "leadId"),
      patientId: num(fd, "patientId"),
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
  const password = str(fd, "password");
  const data: { name: string; login: string; role: string; active: boolean; passwordHash?: string } = {
    name: str(fd, "name"),
    login: str(fd, "login"),
    role,
    active: id ? fd.get("active") === "on" : true,
  };
  if (password) data.passwordHash = await bcrypt.hash(password, 10);
  if (id) await db.user.update({ where: { id }, data });
  else if (data.passwordHash) await db.user.create({ data: { ...data, passwordHash: data.passwordHash } });
  await audit(u.id, "User", id, id ? "update" : "create", { login: data.login, role });
  revalidatePath("/settings");
}

export async function saveDoctor(fd: FormData) {
  const u = await requireHead();
  const id = num(fd, "id");
  const data = {
    name: str(fd, "name"),
    specialty: str(fd, "specialty"),
    room: str(fd, "room") || null,
    userId: num(fd, "userId"),
    active: id ? fd.get("active") === "on" : true,
  };
  if (id) await db.doctor.update({ where: { id }, data });
  else await db.doctor.create({ data });
  await audit(u.id, "Doctor", id, id ? "update" : "create", data.name);
  revalidatePath("/settings");
}

export async function saveService(fd: FormData) {
  const u = await requireHead();
  const id = num(fd, "id");
  const data = {
    nameKk: str(fd, "nameKk"),
    nameRu: str(fd, "nameRu") || str(fd, "nameKk"),
    price: Number(str(fd, "price") || 0),
    durationMin: Number(str(fd, "durationMin") || 30),
    active: id ? fd.get("active") === "on" : true,
  };
  if (id) await db.service.update({ where: { id }, data });
  else await db.service.create({ data });
  await audit(u.id, "Service", id, id ? "update" : "create", data);
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
