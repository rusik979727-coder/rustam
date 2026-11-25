import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser, isHead } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { LEAD_STATUSES, LEAD_SOURCES, COMPLAINTS, LOST_REASONS } from "@/lib/constants";
import { dt, toLocalInput } from "@/lib/format";
import { Field, Select, StatusBadge } from "@/components/ui";
import { Chat } from "@/components/Chat";
import { updateLead, addLeadActivity, reassignLead, convertLead } from "../../actions";

export default async function LeadPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dup?: string; wa?: string }> }) {
  const user = await requireUser(["HEAD_MANAGER", "MANAGER"]);
  const { t } = await getT();
  const id = Number((await params).id);
  const sp = await searchParams;
  const lead = await db.lead.findUnique({
    where: { id },
    include: { manager: true, patient: true, activities: { include: { user: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!lead || (!isHead(user) && lead.managerId !== user.id)) notFound();
  const managers = isHead(user) ? await db.user.findMany({ where: { role: "MANAGER", active: true } }) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/leads" className="link text-sm">← {t("nav.leads")}</Link>
        <h1 className="h1">{lead.name}</h1>
        <StatusBadge status={lead.status} label={t(`status.${lead.status}`)} />
        <span className="text-sm text-slate-500">{t(`source.${lead.source}`)} · {dt(lead.createdAt)}</span>
      </div>
      {sp.dup && <div className="card border-amber-300 bg-amber-50 text-sm">{t("leads.duplicate")}</div>}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <form action={updateLead} className="grid gap-3 md:grid-cols-2">
            <input type="hidden" name="id" value={lead.id} />
            <Field label={t("common.name")}><input name="name" defaultValue={lead.name} className="input" /></Field>
            <Field label={t("common.phone")}>
              <div className="flex gap-2">
                <input name="phone" defaultValue={lead.phone} className="input" />
                <a href={`tel:${lead.phone}`} className="btn-ghost" title="Call">☎</a>
                <a href={`https://wa.me/${lead.phone.replace(/\D/g, "")}`} target="_blank" className="btn-ghost" title="WhatsApp">WA</a>
              </div>
            </Field>
            <Field label={t("leads.source")}><Select name="source" defaultValue={lead.source} options={LEAD_SOURCES.map((s) => ({ value: s, label: t(`source.${s}`) }))} /></Field>
            <Field label={t("leads.complaint")}><Select name="complaint" defaultValue={lead.complaint} options={COMPLAINTS.map((s) => ({ value: s, label: t(`complaint.${s}`) }))} /></Field>
            <Field label={t("common.status")}><Select name="status" defaultValue={lead.status} options={LEAD_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} /></Field>
            <Field label={t("leads.lostReason")}><Select name="lostReason" defaultValue={lead.lostReason} options={[{ value: "", label: "—" }, ...LOST_REASONS.map((s) => ({ value: s, label: t(`lost.${s}`) }))]} /></Field>
            <Field label={t("leads.nextContact")}><input type="datetime-local" name="nextContactAt" defaultValue={lead.nextContactAt ? toLocalInput(lead.nextContactAt) : ""} className="input" /></Field>
            <Field label={t("common.comment")}><input name="comment" defaultValue={lead.comment ?? ""} className="input" /></Field>
            <div className="md:col-span-2"><button className="btn">{t("common.save")}</button></div>
          </form>
        </section>

        <section className="card space-y-3">
          <div className="text-sm"><span className="text-slate-500">{t("common.manager")}:</span> <b>{lead.manager?.name ?? t("common.unassigned")}</b></div>
          {isHead(user) && (
            <form action={reassignLead} className="flex gap-2">
              <input type="hidden" name="id" value={lead.id} />
              <Select name="managerId" defaultValue={lead.managerId} label={t("leads.reassign")} options={managers.map((m) => ({ value: m.id, label: m.name }))} />
              <button className="btn-ghost whitespace-nowrap">{t("leads.reassign")}</button>
            </form>
          )}
          {lead.patient ? (
            <div className="space-y-2">
              <Link className="btn-ghost w-full" href={`/patients/${lead.patient.id}`}>{t("patients.card")}: {lead.patient.fullName}</Link>
              <Link className="btn w-full" href={`/schedule?patient=${lead.patient.id}`}>{t("leads.book")}</Link>
            </div>
          ) : (
            <form action={convertLead}><input type="hidden" name="id" value={lead.id} /><button className="btn w-full">{t("leads.toPatient")}</button></form>
          )}
        </section>
      </div>

      <section className="card" id="chat">
        <h2 className="h2">WhatsApp</h2>
        <Chat phone={lead.phone} t={t} back={`/leads/${lead.id}`} notice={sp.wa} />
      </section>

      <section className="card">
        <h2 className="h2">{t("leads.history")}</h2>
        <form action={addLeadActivity} className="mb-4 flex flex-wrap gap-2">
          <input type="hidden" name="id" value={lead.id} />
          <Select name="type" className="input w-36" label="type" options={["CALL", "MESSAGE", "NOTE"].map((x) => ({ value: x, label: t(`act.${x}`) }))} />
          <input name="text" className="input min-w-[200px] flex-1" placeholder={t("leads.addNote")} required />
          <button className="btn">{t("common.add")}</button>
        </form>
        <ul className="space-y-2 text-sm">
          {lead.activities.map((a) => (
            <li key={a.id} className="flex gap-3 border-l-2 border-brand-100 pl-3">
              <span className="w-28 shrink-0 text-xs text-slate-400">{dt(a.createdAt)}</span>
              <span className="badge h-fit bg-slate-100 text-slate-600">{t(`act.${a.type}`)}</span>
              <span className="flex-1">{a.text}</span>
              <span className="text-xs text-slate-400">{a.user?.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
