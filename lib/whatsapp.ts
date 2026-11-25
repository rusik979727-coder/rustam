/**
 * WhatsApp Business Cloud API (Meta) — CRM ішіндегі чат және үнемді еске салулар.
 *
 * Баға ережесі (қысқаша): клиент соңғы рет жазғаннан кейінгі 24 сағат ішінде («терезе»)
 * кез келген хабарлама тегін. Терезе жабық болса — тек Meta бекіткен үлгі (template)
 * хабарлама жіберуге болады және ол ақылы.
 */
import { db } from "./db";
import { normalizePhone } from "./phone";

// WA_API_BASE — тек тестілеу үшін (жалған сервер); әдепкі Meta Graph API
const GRAPH = process.env.WA_API_BASE || "https://graph.facebook.com/v21.0";
/** Тегін терезе 24 сағат; шекарада қателеспеу үшін 23 сағат деп санаймыз */
export const WINDOW_MS = 23 * 3600_000;

export const waConfigured = () => !!(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID);

/* ---------------- Таза логика (тесттелетін) ---------------- */

export function isWindowOpen(lastInboundAt: Date | null | undefined, now = new Date()) {
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < WINDOW_MS;
}

export type ReminderDecision = "free" | "paid" | "skip" | null;

/**
 * Қабылдау туралы еске салу: тегін мүмкіндік болса — тегін, ақылы — тек соңғы шара.
 * - Негізгі еске салу (REMINDER_HOURS бұрын, әдепкі 24):
 *     терезе ашық → тегін мәтін; пациент растап қойған → ештеңе жібермейміз;
 *     әйтпесе → ақылы үлгі (бір рет қана).
 * - Сол күнгі еске салу (2 сағат бұрын): тек терезе ашық болса (тегін), әйтпесе жібермейміз.
 */
export function decideReminder(a: {
  now: Date;
  startAt: Date;
  status: string;
  lastInboundAt: Date | null;
  mainSent: boolean;
  sameDaySent: boolean;
  hoursBefore: number;
}): { main: ReminderDecision; sameDay: ReminderDecision } {
  const res: { main: ReminderDecision; sameDay: ReminderDecision } = { main: null, sameDay: null };
  if (!["BOOKED", "CONFIRMED"].includes(a.status) || a.startAt <= a.now) return res;
  const left = a.startAt.getTime() - a.now.getTime();
  const open = isWindowOpen(a.lastInboundAt, a.now);

  if (!a.mainSent && left <= a.hoursBefore * 3600_000) {
    res.main = open ? "free" : a.status === "CONFIRMED" ? "skip" : "paid";
  }
  if (!a.sameDaySent && left <= 2 * 3600_000) {
    res.sameDay = open ? "free" : "skip";
  }
  return res;
}

/* ---------------- Дерекқор көмекшілері ---------------- */

export async function lastInboundAt(phone: string) {
  const m = await db.message.findFirst({
    where: { phone, direction: "IN" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return m?.createdAt ?? null;
}

async function links(phone: string) {
  const lead = await db.lead.findFirst({ where: { phone }, orderBy: { createdAt: "desc" }, select: { id: true } });
  return { leadId: lead?.id ?? null };
}

/** Кіріс хабарламаны сақтау (webhook). waId бойынша қайталанбайды. */
export async function saveInbound(rawPhone: string, text: string, waId?: string) {
  const phone = normalizePhone(rawPhone);
  if (waId && (await db.message.findUnique({ where: { waId } }))) return null;
  return db.message.create({ data: { phone, direction: "IN", text: text || "[медиа]", waId: waId ?? null, ...(await links(phone)) } });
}

/** Жеткізу статусы (sent/delivered/read/failed) — webhook statuses */
export async function updateStatus(waId: string, status: string, error?: string) {
  const order = ["queued", "sent", "delivered", "read"];
  const m = await db.message.findUnique({ where: { waId } });
  if (!m) return;
  // Статус артқа кетпеуі үшін (webhook-тер ретсіз келуі мүмкін)
  if (status !== "failed" && order.indexOf(status) <= order.indexOf(m.status)) return;
  await db.message.update({ where: { waId }, data: { status, error: error ?? null } });
}

/* ---------------- Жіберу ---------------- */

async function graphSend(body: object): Promise<{ ok: boolean; id?: string; error?: string }> {
  try {
    const r = await fetch(`${GRAPH}/${process.env.WA_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WA_TOKEN}` },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const j = (await r.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
    if (!r.ok) return { ok: false, error: j.error?.message ?? `HTTP ${r.status}` };
    return { ok: true, id: j.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export type SendResult = { ok: boolean; status: string; reason?: "window_closed" | "offline" | "error"; error?: string };

/**
 * Еркін мәтін — ТЕК терезе ашық болса (тегін). Терезе жабық болса жібермейді.
 * WhatsApp қосылмаған болса — хабар «offline» ретінде сақталады (менеджер қолмен жібереді).
 */
export async function sendText(rawPhone: string, text: string, userId: number | null = null): Promise<SendResult> {
  const phone = normalizePhone(rawPhone);
  if (!(await isWindowOpenFor(phone))) return { ok: false, status: "blocked", reason: "window_closed" };
  const base = { phone, direction: "OUT", kind: "TEXT", text, userId, ...(await links(phone)) };
  if (!waConfigured()) {
    await db.message.create({ data: { ...base, status: "offline" } });
    return { ok: false, status: "offline", reason: "offline" };
  }
  const r = await graphSend({ to: phone.replace(/\D/g, ""), type: "text", text: { body: text, preview_url: false } });
  await db.message.create({ data: { ...base, status: r.ok ? "sent" : "failed", waId: r.id ?? null, error: r.error ?? null } });
  return r.ok ? { ok: true, status: "sent" } : { ok: false, status: "failed", reason: "error", error: r.error };
}

export async function isWindowOpenFor(phone: string, now = new Date()) {
  return isWindowOpen(await lastInboundAt(phone), now);
}

/** Meta-да бекітілген үлгілер атауы (.env арқылы өзгертуге болады) */
export const TEMPLATES = {
  reminder: () => process.env.WA_TPL_REMINDER || "appointment_reminder",
  followup: () => process.env.WA_TPL_FOLLOWUP || "client_followup",
  lang: () => process.env.WA_TPL_LANG || "kk",
};

/** Үлгі хабарлама — АҚЫЛЫ (терезе жабық кезде). preview — CRM чатында көрсетілетін мәтін. */
export async function sendTemplate(
  rawPhone: string,
  name: string,
  params: string[],
  preview: string,
  userId: number | null = null,
): Promise<SendResult> {
  const phone = normalizePhone(rawPhone);
  const base = { phone, direction: "OUT", kind: "TEMPLATE", text: preview, userId, paid: true, ...(await links(phone)) };
  if (!waConfigured()) {
    await db.message.create({ data: { ...base, paid: false, status: "offline" } });
    return { ok: false, status: "offline", reason: "offline" };
  }
  const r = await graphSend({
    to: phone.replace(/\D/g, ""),
    type: "template",
    template: {
      name,
      language: { code: TEMPLATES.lang() },
      components: params.length ? [{ type: "body", parameters: params.map((p) => ({ type: "text", text: p })) }] : [],
    },
  });
  await db.message.create({ data: { ...base, status: r.ok ? "sent" : "failed", waId: r.id ?? null, error: r.error ?? null } });
  return r.ok ? { ok: true, status: "sent" } : { ok: false, status: "failed", reason: "error", error: r.error };
}

/** Осы айдағы ақылы хабарламалар саны (бас менеджер панелі үшін) */
export async function paidThisMonth(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return db.message.count({ where: { paid: true, status: { not: "failed" }, createdAt: { gte: from } } });
}
