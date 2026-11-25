import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { visiblePhones, canChat } from "@/lib/chat-access";
import { isWindowOpen, paidThisMonth } from "@/lib/whatsapp";
import { normalizePhone } from "@/lib/phone";
import { dt } from "@/lib/format";
import { Chat } from "@/components/Chat";
import { Empty, StatusBadge } from "@/components/ui";
import { AutoRefresh } from "@/components/AutoRefresh";

export default async function ChatsPage({ searchParams }: { searchParams: Promise<{ phone?: string; wa?: string; f?: string }> }) {
  const user = await requireUser(["HEAD_MANAGER", "MANAGER"]);
  const { t } = await getT();
  const sp = await searchParams;
  const phones = await visiblePhones(user);
  const where = phones ? { phone: { in: phones } } : {};

  // Әр нөмір бойынша соңғы хабарлама
  const recent = await db.message.findMany({ where, orderBy: { createdAt: "desc" }, take: 1000 });
  const byPhone = new Map<string, typeof recent>();
  for (const m of recent) {
    const xs = byPhone.get(m.phone) ?? [];
    xs.push(m);
    byPhone.set(m.phone, xs);
  }
  const list = await Promise.all(
    [...byPhone.entries()].map(async ([phone, msgs]) => {
      const lead = await db.lead.findFirst({ where: { phone }, orderBy: { createdAt: "desc" }, include: { manager: true } });
      const patient = await db.patient.findUnique({ where: { phone } });
      const lastIn = msgs.find((m) => m.direction === "IN")?.createdAt ?? null;
      return {
        phone,
        name: patient?.fullName ?? lead?.name ?? phone,
        lead,
        patient,
        last: msgs[0],
        unread: msgs.filter((m) => m.direction === "IN" && !m.readAt).length,
        awaiting: msgs[0].direction === "IN", // соңғы хабар клиенттен — жауап күтуде
        open: isWindowOpen(lastIn),
      };
    }),
  );
  const filtered = list.filter((c) => (sp.f === "awaiting" ? c.awaiting : sp.f === "unread" ? c.unread > 0 : true));
  const selected = sp.phone ? normalizePhone(sp.phone) : null;
  const allowed = selected ? await canChat(user, selected) : false;
  const sel = list.find((c) => c.phone === selected);
  const paid = user.role === "HEAD_MANAGER" ? await paidThisMonth() : null;
  const back = selected ? `/chats?phone=${encodeURIComponent(selected)}` : "/chats";

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={20} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">WhatsApp</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[["", t("common.all")], ["awaiting", t("chat.awaiting")], ["unread", t("chat.unread")]].map(([k, l]) => (
            <Link key={k} href={k ? `/chats?f=${k}` : "/chats"} className={`rounded-lg px-3 py-1.5 ${(sp.f ?? "") === k ? "bg-brand-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>{l}</Link>
          ))}
          {paid !== null && <span className="badge bg-amber-50 text-amber-800 ring-1 ring-amber-200">{t("chat.paidMonth")}: {paid}</span>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <section className="card max-h-[75vh] overflow-y-auto p-0">
          {filtered.length === 0 ? <Empty text={t("chat.empty")} /> : (
            <ul className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <li key={c.phone}>
                  <Link href={`/chats?phone=${encodeURIComponent(c.phone)}${sp.f ? `&f=${sp.f}` : ""}`} className={`block px-3 py-2 hover:bg-slate-50 ${c.phone === selected ? "bg-brand-50" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className="shrink-0 text-[11px] text-slate-400">{dt(c.last.createdAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-xs ${c.awaiting ? "font-medium text-slate-800" : "text-slate-500"}`}>{c.last.direction === "OUT" ? "↪ " : ""}{c.last.text}</span>
                      {c.unread > 0 && <span className="badge shrink-0 bg-emerald-600 text-white">{c.unread}</span>}
                    </div>
                    <div className="mt-0.5 flex gap-2 text-[11px] text-slate-400">
                      {c.lead && <span>{t(`status.${c.lead.status}`)}</span>}
                      {user.role === "HEAD_MANAGER" && c.lead && <span>· {c.lead.manager?.name ?? t("common.unassigned")}</span>}
                      <span>· {c.open ? "🟢" : "⚪"}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          {!selected ? <Empty text={t("chat.select")} /> : !allowed ? <Empty text="404" /> : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{sel?.name ?? selected}</h2>
                <span className="text-sm text-slate-500">{selected}</span>
                {sel?.lead && <StatusBadge status={sel.lead.status} label={t(`status.${sel.lead.status}`)} />}
                <span className="ml-auto flex gap-2">
                  {sel?.lead && <Link className="btn-ghost btn-sm" href={`/leads/${sel.lead.id}`}>{t("nav.leads")}</Link>}
                  {sel?.patient && <Link className="btn-ghost btn-sm" href={`/patients/${sel.patient.id}`}>{t("patients.card")}</Link>}
                </span>
              </div>
              <Chat phone={selected} t={t} back={back} notice={sp.wa} />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
