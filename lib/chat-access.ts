import { db } from "./db";
import type { CurrentUser } from "./auth";

/** Бас менеджер — барлық чат; менеджер — өз өтінімдерінің және пациенттердің нөмірлері; дәрігер — жоқ. */
export async function canChat(user: CurrentUser, phone: string) {
  if (user.role === "HEAD_MANAGER") return true;
  if (user.role !== "MANAGER") return false;
  const lead = await db.lead.findFirst({ where: { phone }, orderBy: { createdAt: "desc" }, select: { managerId: true } });
  if (lead) return lead.managerId === user.id;
  return (await db.patient.count({ where: { phone } })) > 0;
}

/** Менеджерге көрінетін нөмірлер шарты (кіріс жәшігі үшін). null — шектеусіз. */
export async function visiblePhones(user: CurrentUser): Promise<string[] | null> {
  if (user.role === "HEAD_MANAGER") return null;
  if (user.role !== "MANAGER") return [];
  const leads = await db.lead.findMany({ where: { managerId: user.id }, select: { phone: true } });
  return [...new Set(leads.map((l) => l.phone))];
}
