"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { canChat } from "@/lib/chat-access";
import { sendText, sendTemplate, TEMPLATES } from "@/lib/whatsapp";
import { normalizePhone } from "@/lib/phone";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

const backTo = (fd: FormData) => {
  const b = String(fd.get("back") ?? "/chats");
  return b.startsWith("/") ? b : "/chats";
};
const withParam = (url: string, k: string, v: string) => `${url}${url.includes("?") ? "&" : "?"}${k}=${v}`;

export async function sendChatMessage(fd: FormData) {
  const u = await requireUser(["HEAD_MANAGER", "MANAGER"]);
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  const text = String(fd.get("text") ?? "").trim().slice(0, 4000);
  const back = backTo(fd);
  if (!text) redirect(back);
  if (!(await canChat(u, phone))) throw new Error("Forbidden");
  const r = await sendText(phone, text, u.id);
  // Менеджер жазды — өтінімге алғашқы жауап ретінде есептеледі
  await db.lead.updateMany({ where: { phone, firstResponseAt: null }, data: { firstResponseAt: new Date() } });
  await db.lead.updateMany({ where: { phone, status: { in: ["NEW", "NO_ANSWER"] } }, data: { status: "CONTACTED" } });
  revalidatePath(back.split("?")[0]);
  if (r.reason === "window_closed") redirect(withParam(back, "wa", "closed"));
  if (r.reason === "error") redirect(withParam(back, "wa", "error"));
  redirect(back.replace(/[?&]wa=\w+/, ""));
}

/** Терезе жабық кезде — ақылы үлгі хабарлама (Meta бекіткен «patient_followup»). */
export async function sendFollowupTemplate(fd: FormData) {
  const u = await requireUser(["HEAD_MANAGER", "MANAGER"]);
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  if (!(await canChat(u, phone))) throw new Error("Forbidden");
  const name = (await db.lead.findFirst({ where: { phone }, orderBy: { createdAt: "desc" } }))?.name ?? "";
  const r = await sendTemplate(
    phone,
    TEMPLATES.followup(),
    [name],
    `[Үлгі, ақылы] Сәлеметсіз бе, ${name}! Белес клиникасынан жазып тұрмыз. Ыңғайлы болса, осы чатқа жауап беріңіз.`,
    u.id,
  );
  await audit(u.id, "Message", null, "template_sent", { phone, ok: r.ok });
  const back = backTo(fd);
  revalidatePath(back.split("?")[0]);
  redirect(r.reason === "error" ? withParam(back, "wa", "error") : back.replace(/[?&]wa=\w+/, ""));
}
