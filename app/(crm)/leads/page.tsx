import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser, isHead } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { LEAD_STATUSES, LEAD_SOURCES, COMPLAINTS, LOST_REASONS } from "@/lib/constants";
import { dt, addDays } from "@/lib/format";
import { Field, Select } from "@/components/ui";
import { createLead, moveLead } from "../actions";

const NEXT: Record<string, string[]> = {
  NEW: ["CONTACTED", "BOOKED"],
  CONTACTED: ["BOOKED"],
  BOOKED: ["ARRIVED"],
  ARRIVED: ["PAID"],
  PAID: [],
  LOST: ["NEW"],
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser(["HEAD_MANAGER", "MANAGER"]);
  const { t } = await getT();
  const sp = await searchParams;
  const head = isHead(user);
  const escMin = Number(process.env.ESCALATION_MINUTES || 15);
  const now = new Date();

  const closedSince = addDays(now, -30);
  // Жабық (PAID/LOST) өтінімдер тек соңғы 30 күн бойынша көрсетіледі
  const and: Prisma.LeadWhereInput[] = [{ OR: [{ status: { notIn: ["PAID", "LOST"] } }, { updatedAt: { gte: closedSince } }] }];
  if (!head) and.push({ managerId: user.id });
  else if (sp.manager === "none") and.push({ managerId: null });
  else if (sp.manager) and.push({ managerId: Number(sp.manager) });
  if (sp.source) and.push({ source: sp.source });
  if (sp.complaint) and.push({ complaint: sp.complaint });
  if (sp.q) and.push({ OR: [{ name: { contains: sp.q } }, { phone: { contains: sp.q.replace(/\D/g, "") || sp.q } }] });

  const [leads, managers] = await Promise.all([
    db.lead.findMany({ where: { AND: and }, include: { manager: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    db.user.findMany({ where: { role: "MANAGER", active: true }, orderBy: { name: "asc" } }),
  ]);

  const sourceOpts = LEAD_SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) }));
  const complaintOpts = COMPLAINTS.map((s) => ({ value: s, label: t(`complaint.${s}`) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{t("leads.title")}</h1>
        <form className="flex flex-wrap gap-2">
          <input name="q" defaultValue={sp.q} placeholder={t("common.search")} className="input w-44" />
          {head && (
            <Select name="manager" defaultValue={sp.manager} className="input w-40" label={t("common.manager")} options={[{ value: "", label: `${t("common.manager")}: ${t("common.all")}` }, { value: "none", label: t("common.unassigned") }, ...managers.map((m) => ({ value: m.id, label: m.name }))]} />
          )}
          <Select name="source" defaultValue={sp.source} className="input w-36" label={t("leads.source")} options={[{ value: "", label: `${t("leads.source")}: ${t("common.all")}` }, ...sourceOpts]} />
          <Select name="complaint" defaultValue={sp.complaint} className="input w-40" label={t("leads.complaint")} options={[{ value: "", label: `${t("leads.complaint")}: ${t("common.all")}` }, ...complaintOpts]} />
          <button className="btn-ghost">{t("common.filter")}</button>
        </form>
      </div>

      <details className="card" open={leads.length === 0}>
        <summary className="cursor-pointer font-medium text-brand-700">+ {t("leads.new")}</summary>
        <form action={createLead} className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Field label={t("common.name")}><input name="name" className="input" /></Field>
          <Field label={t("common.phone")}><input name="phone" className="input" required placeholder="+7 7__ ___ __ __" /></Field>
          <Field label={t("leads.source")}><Select name="source" options={sourceOpts} defaultValue="CALL" /></Field>
          <Field label={t("leads.complaint")}><Select name="complaint" options={complaintOpts} defaultValue="HERNIA" /></Field>
          {head ? (
            <Field label={t("common.manager")}><Select name="managerId" options={[{ value: "auto", label: t("dash.autoAssign") }, ...managers.map((m) => ({ value: m.id, label: m.name }))]} /></Field>
          ) : <div />}
          <Field label={t("common.comment")}><input name="comment" className="input" /></Field>
          <div className="md:col-span-3 lg:col-span-6"><button className="btn">{t("common.create")}</button></div>
        </form>
      </details>

      <div className="flex gap-3 overflow-x-auto pb-4">
        {LEAD_STATUSES.map((st) => {
          const col = leads.filter((l) => l.status === st);
          return (
            <section key={st} className="w-72 shrink-0 rounded-xl bg-slate-100 p-2">
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold text-slate-700">
                <span>{t(`status.${st}`)}</span>
                <span className="badge bg-white text-slate-600">{col.length}</span>
              </h2>
              <div className="space-y-2">
                {col.map((l) => {
                  const late = l.status === "NEW" && !l.firstResponseAt && now.getTime() - l.createdAt.getTime() > escMin * 60000;
                  const callDue = l.nextContactAt && l.nextContactAt < now && !["PAID", "LOST"].includes(l.status);
                  return (
                    <article key={l.id} className={`rounded-lg border bg-white p-2 text-sm shadow-sm ${late ? "border-red-400" : "border-slate-200"}`}>
                      <Link href={`/leads/${l.id}`} className="block">
                        <div className="flex items-start justify-between gap-1">
                          <span className="font-medium text-slate-900">{l.name}</span>
                          <span className="text-[10px] text-slate-400">{t(`source.${l.source}`)}</span>
                        </div>
                        <div className="text-xs text-slate-500">{l.phone}</div>
                        <div className="mt-1 text-xs">{t(`complaint.${l.complaint}`)}</div>
                        {late && <div className="mt-1 text-xs font-semibold text-red-600">⚠ {t("leads.escalated")}</div>}
                        {callDue && <div className="mt-1 text-xs text-amber-700">☎ {dt(l.nextContactAt)}</div>}
                        {head && <div className="mt-1 text-[11px] text-slate-400">{l.manager?.name ?? t("common.unassigned")}</div>}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {NEXT[st].map((ns) => (
                          <form key={ns} action={moveLead}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="status" value={ns} />
                            <button className="btn-ghost btn-sm">→ {t(`status.${ns}`)}</button>
                          </form>
                        ))}
                        {st !== "LOST" && st !== "PAID" && (
                          <form action={moveLead} className="flex gap-1">
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="status" value="LOST" />
                            <select name="lostReason" className="rounded border border-slate-200 text-[11px]" aria-label={t("leads.lostReason")}>
                              {LOST_REASONS.map((r) => <option key={r} value={r}>{t(`lost.${r}`)}</option>)}
                            </select>
                            <button className="btn-ghost btn-sm text-red-600">✕</button>
                          </form>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
