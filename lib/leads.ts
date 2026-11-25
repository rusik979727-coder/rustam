import { db } from "./db";
import { pickManager } from "./assign";
import { normalizePhone } from "./phone";
import { audit } from "./audit";
import { OPEN_LEAD_STATUSES, LEAD_SOURCES, COMPLAINTS } from "./constants";

/** Round-robin бойынша келесі менеджерді таңдап, оның lastAssignedAt-ын жаңартады. */
export async function autoAssignManager(): Promise<number | null> {
  const managers = await db.user.findMany({
    where: { role: "MANAGER", active: true },
    select: { id: true, lastAssignedAt: true },
  });
  const m = pickManager(managers);
  if (!m) return null;
  await db.user.update({ where: { id: m.id }, data: { lastAssignedAt: new Date() } });
  return m.id;
}

export type IncomingLead = {
  name?: string;
  phone: string;
  source?: string;
  complaint?: string;
  comment?: string;
  managerId?: number | null;
  createdBy?: number | null;
};

/** Шағым мәтінінен диагнозды болжау (сайт формаларынан еркін мәтін келгенде). */
export function guessComplaint(text?: string): string {
  const s = (text || "").toLowerCase();
  if (/грыж|hernia|жарық/.test(s)) return "HERNIA";
  if (/протруз|protrus/.test(s)) return "PROTRUSION";
  if (/артроз|arthros/.test(s)) return "ARTHROSIS";
  if (/артрит|arthrit/.test(s)) return "ARTHRITIS";
  return "OTHER";
}

/**
 * Жаңа өтінімді тіркеу (қолмен де, webhook арқылы да).
 * - нөмір бойынша ашық өтінім бар болса — жаңасы құрылмай, соған жазба қосылады;
 * - бар пациент болса — өтінім соған байланады;
 * - менеджер көрсетілмесе — автобөлу.
 */
export async function createIncomingLead(input: IncomingLead) {
  const phone = normalizePhone(input.phone);
  const source = (LEAD_SOURCES as readonly string[]).includes(input.source ?? "") ? input.source! : "OTHER";
  const complaint = (COMPLAINTS as readonly string[]).includes(input.complaint ?? "")
    ? input.complaint!
    : guessComplaint(`${input.complaint ?? ""} ${input.comment ?? ""}`);

  const open = await db.lead.findFirst({
    where: { phone, status: { in: OPEN_LEAD_STATUSES } },
    orderBy: { createdAt: "desc" },
  });
  if (open) {
    await db.leadActivity.create({
      data: {
        leadId: open.id,
        userId: input.createdBy ?? null,
        type: "MESSAGE",
        text: `[${source}] ${input.comment || "Қайта хабарласты"}`,
      },
    });
    return { lead: open, duplicate: true };
  }

  const patient = await db.patient.findUnique({ where: { phone } });
  const managerId = input.managerId === undefined || input.managerId === null ? await autoAssignManager() : input.managerId;

  const lead = await db.lead.create({
    data: {
      name: input.name?.trim() || patient?.fullName || phone,
      phone,
      source,
      complaint,
      comment: input.comment || null,
      managerId,
      patientId: patient?.id ?? null,
      activities: { create: { type: "SYSTEM", text: `Өтінім түсті: ${source}`, userId: input.createdBy ?? null } },
    },
  });
  await audit(input.createdBy ?? null, "Lead", lead.id, "create", { source, managerId });
  return { lead, duplicate: false };
}
