import { db } from "@/lib/db";
import type { T } from "@/lib/i18n";
import { isWindowOpen, WINDOW_MS, waConfigured } from "@/lib/whatsapp";
import { dt, time } from "@/lib/format";
import { sendChatMessage, sendFollowupTemplate } from "@/app/(crm)/chat-actions";
import { AutoRefresh, ScrollToBottom } from "./AutoRefresh";

const STATUS_ICON: Record<string, string> = { sent: "✓", delivered: "✓✓", read: "✓✓", failed: "⚠", offline: "⏸", queued: "…" };

export async function Chat({ phone, t, back, notice, canSend = true }: { phone: string; t: T; back: string; notice?: string; canSend?: boolean }) {
  if (phone.startsWith("ig:")) return <p className="text-sm text-slate-500">{t("chat.instagramNoPhone")}</p>;
  const messages = (await db.message.findMany({ where: { phone }, include: { user: true }, orderBy: { createdAt: "desc" }, take: 100 })).reverse();
  // Ашылған чаттағы кіріс хабарламалар оқылды деп белгіленеді
  await db.message.updateMany({ where: { phone, direction: "IN", readAt: null }, data: { readAt: new Date() } });

  const lastIn = [...messages].reverse().find((m) => m.direction === "IN")?.createdAt ?? null;
  const open = isWindowOpen(lastIn);
  const closesAt = lastIn ? new Date(lastIn.getTime() + WINDOW_MS) : null;
  const boxId = `chat-${phone.replace(/\D/g, "")}`;

  return (
    <div className="flex flex-col gap-2">
      <AutoRefresh />
      <ScrollToBottom id={boxId} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className={`badge ${open ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
          {open ? `${t("chat.windowOpen")} · ${t("chat.until")} ${time(closesAt!)}` : t("chat.windowClosed")}
        </span>
        {!waConfigured() && <span className="text-slate-500">{t("chat.offline")}</span>}
      </div>
      {notice === "closed" && <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-800" role="alert">{t("chat.closedNotice")}</div>}
      {notice === "error" && <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700" role="alert">{t("chat.error")}</div>}

      <div id={boxId} className="max-h-[420px] min-h-[160px] space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-3">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-slate-400">{t("chat.empty")}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.direction === "OUT" ? (m.kind === "TEMPLATE" ? "bg-amber-50 ring-1 ring-amber-200" : "bg-brand-100") : "bg-white"}`}>
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
              <div className="mt-1 flex justify-end gap-1 text-[10px] text-slate-500">
                {m.user && <span>{m.user.name} ·</span>}
                {m.paid && <span className="font-medium text-amber-700">{t("chat.paid")} ·</span>}
                <span>{dt(m.createdAt)}</span>
                {m.direction === "OUT" && <span className={m.status === "read" ? "text-sky-600" : m.status === "failed" ? "text-red-600" : ""} title={m.error ?? m.status}>{STATUS_ICON[m.status] ?? ""}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>

      {canSend && (open ? (
        <form action={sendChatMessage} className="flex gap-2">
          <input type="hidden" name="phone" value={phone} />
          <input type="hidden" name="back" value={back} />
          <textarea name="text" rows={2} required maxLength={4000} className="input flex-1" placeholder={t("chat.placeholder")} />
          <button className="btn self-end">{t("chat.send")}</button>
        </form>
      ) : (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p>{t("chat.closedHelp")}</p>
          <div className="flex flex-wrap gap-2">
            <a className="btn-ghost btn-sm" href={`https://wa.me/${phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer">{t("chat.openWa")}</a>
            <form action={sendFollowupTemplate}>
              <input type="hidden" name="phone" value={phone} />
              <input type="hidden" name="back" value={back} />
              <button className="btn-ghost btn-sm border-amber-300 text-amber-800">{t("chat.sendTemplate")}</button>
            </form>
          </div>
        </div>
      ))}
    </div>
  );
}
