import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { patientBalance } from "@/lib/finance";
import { money, dt, dateOnly } from "@/lib/format";
import { PAYMENT_METHODS, COMPLAINTS, APPT_STATUSES } from "@/lib/constants";
import { Field, Select, StatusBadge, Empty, Stat } from "@/components/ui";
import { PatientForm } from "@/components/PatientForm";
import { createCourse, setCourseStatus, addMedicalNote, uploadFile, createPayment, setAppointmentStatus } from "../../actions";

export default async function PatientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ dup?: string }> }) {
  const user = await requireUser();
  const { t, locale } = await getT();
  const id = Number((await params).id);
  const sp = await searchParams;
  const p = await db.patient.findUnique({
    where: { id },
    include: {
      courses: { include: { doctor: true }, orderBy: { createdAt: "desc" } },
      appointments: { include: { doctor: true, service: true }, orderBy: { startAt: "desc" } },
      payments: { include: { manager: true }, orderBy: { createdAt: "desc" } },
      medicalNotes: { include: { author: true }, orderBy: { createdAt: "desc" } },
      attachments: { orderBy: { createdAt: "desc" } },
      leads: { include: { manager: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!p) notFound();
  const doctors = await db.doctor.findMany({ where: { active: true } });
  const bal = patientBalance(p);
  const staff = user.role !== "DOCTOR";
  const svcName = (s: { nameKk: string; nameRu: string }) => (locale === "ru" ? s.nameRu : s.nameKk);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/patients" className="link text-sm">← {t("nav.patients")}</Link>
        <h1 className="h1">{p.fullName}</h1>
        <span className="text-sm text-slate-500">{p.phone}</span>
        {p.diagnosis && <span className="badge bg-brand-100 text-brand-700">{t(`complaint.${p.diagnosis}`)}</span>}
        <Link href={`/schedule?patient=${p.id}`} className="btn ml-auto">{t("sched.new")}</Link>
      </div>
      {sp.dup && <div className="card border-amber-300 bg-amber-50 text-sm">{t("leads.duplicate")}</div>}

      {staff && (
        <section className="grid grid-cols-3 gap-3">
          <Stat label={t("patients.charged")} value={money(bal.charged)} />
          <Stat label={t("patients.paidSum")} value={money(bal.paid)} tone="good" />
          <Stat label={t("patients.debt")} value={money(bal.debt)} tone={bal.debt ? "alert" : "default"} />
        </section>
      )}

      <details className="card">
        <summary className="cursor-pointer font-medium text-brand-700">{t("common.open")}: {t("common.name")}, {t("patients.iin")}, {t("patients.birth")}…</summary>
        <div className="mt-3"><PatientForm t={t} p={p} /></div>
      </details>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Ем курстары */}
        <section className="card">
          <h2 className="h2">{t("patients.courses")}</h2>
          {p.courses.length === 0 ? <Empty text={t("common.empty")} /> : (
            <ul className="mb-3 space-y-2">
              {p.courses.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <b>{c.title}</b>
                    <StatusBadge status={c.status} label={t(`course.status.${c.status}`)} />
                  </div>
                  <div className="mt-1 text-slate-600">
                    {t("course.progress")}: <b>{c.doneSessions} / {c.totalSessions}</b>
                    {staff && <> · {money(c.price)}</>} · {c.doctor?.name ?? "—"}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100" role="progressbar" aria-valuenow={c.doneSessions} aria-valuemax={c.totalSessions} aria-label={c.title}>
                    <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${Math.min(100, (c.doneSessions / c.totalSessions) * 100)}%` }} />
                  </div>
                  {c.status === "ACTIVE" && (
                    <div className="mt-2 flex gap-2">
                      <form action={setCourseStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="DONE" /><button className="btn-ghost btn-sm">{t("course.status.DONE")}</button></form>
                      <form action={setCourseStatus}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="CANCELLED" /><button className="btn-ghost btn-sm">{t("course.status.CANCELLED")}</button></form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <details>
            <summary className="cursor-pointer text-sm font-medium text-brand-700">+ {t("course.new")}</summary>
            <form action={createCourse} className="mt-2 grid gap-2 md:grid-cols-2">
              <input type="hidden" name="patientId" value={p.id} />
              <Field label={t("course.title")}><input name="title" className="input" required placeholder="Грыжа L4-L5 — кешенді ем" /></Field>
              <Field label={t("course.sessions")}><input type="number" name="totalSessions" defaultValue={10} min={1} className="input" /></Field>
              <Field label={t("common.price")}><input type="number" name="price" defaultValue={0} min={0} step="any" className="input" /></Field>
              <Field label={t("common.doctor")}><Select name="doctorId" options={[{ value: "", label: "—" }, ...doctors.map((d) => ({ value: d.id, label: d.name }))]} /></Field>
              <div><button className="btn">{t("common.create")}</button></div>
            </form>
          </details>
        </section>

        {/* Медициналық карта */}
        <section className="card">
          <h2 className="h2">{t("patients.card")}</h2>
          <form action={addMedicalNote} className="mb-3 space-y-2">
            <input type="hidden" name="patientId" value={p.id} />
            <Select name="diagnosis" label={t("patients.diagnosis")} options={[{ value: "", label: `${t("patients.diagnosis")}: —` }, ...COMPLAINTS.map((c) => ({ value: c, label: t(`complaint.${c}`) }))]} />
            <textarea name="text" rows={3} className="input" placeholder={t("patients.notes")} required />
            <button className="btn">{t("common.add")}</button>
          </form>
          <ul className="space-y-2 text-sm">
            {p.medicalNotes.map((n) => (
              <li key={n.id} className="border-l-2 border-brand-100 pl-3">
                <div className="text-xs text-slate-400">{dt(n.createdAt)} · {n.author.name}{n.diagnosis ? ` · ${t(`complaint.${n.diagnosis}`)}` : ""}</div>
                <div className="whitespace-pre-wrap">{n.text}</div>
              </li>
            ))}
          </ul>
          <h2 className="h2 mt-4">{t("patients.files")}</h2>
          <form action={uploadFile} className="mb-2 flex gap-2">
            <input type="hidden" name="patientId" value={p.id} />
            <input type="file" name="file" className="text-sm" accept="image/*,.pdf,.doc,.docx" required />
            <button className="btn-ghost btn-sm">{t("patients.upload")}</button>
          </form>
          <ul className="text-sm">
            {p.attachments.map((a) => (
              <li key={a.id}><a className="link" href={`/api/files/${a.id}`} target="_blank">{a.fileName}</a> <span className="text-xs text-slate-400">{dateOnly(a.createdAt)}</span></li>
            ))}
          </ul>
        </section>

        {/* Қабылдаулар */}
        <section className="card overflow-x-auto">
          <h2 className="h2">{t("patients.appointments")}</h2>
          {p.appointments.length === 0 ? <Empty text={t("common.empty")} /> : (
            <table className="table">
              <tbody>
                {p.appointments.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{dt(a.startAt)}</td>
                    <td>{svcName(a.service)}<div className="text-xs text-slate-500">{a.doctor.name}</div></td>
                    <td>
                      <form action={setAppointmentStatus} className="flex gap-1">
                        <input type="hidden" name="id" value={a.id} />
                        <Select name="status" defaultValue={a.status} className="rounded border border-slate-200 text-xs" label={t("common.status")} options={APPT_STATUSES.map((s) => ({ value: s, label: t(`appt.${s}`) }))} />
                        <button className="btn-ghost btn-sm">OK</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Төлемдер */}
        {staff && (
          <section className="card overflow-x-auto">
            <h2 className="h2">{t("patients.payments")}</h2>
            <form action={createPayment} className="mb-3 grid gap-2 md:grid-cols-4">
              <input type="hidden" name="patientId" value={p.id} />
              <input type="number" name="amount" min={1} step="any" className="input" placeholder={t("common.amount")} required defaultValue={bal.debt || ""} />
              <Select name="method" label={t("common.method")} options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`method.${m}`) }))} />
              <Select name="courseId" label={t("patients.courses")} options={[{ value: "", label: "—" }, ...p.courses.filter((c) => c.status !== "CANCELLED").map((c) => ({ value: c.id, label: c.title }))]} />
              <button className="btn">{t("pay.new")}</button>
            </form>
            {p.payments.length === 0 ? <Empty text={t("common.empty")} /> : (
              <table className="table">
                <tbody>
                  {p.payments.map((x) => (
                    <tr key={x.id}><td className="whitespace-nowrap">{dt(x.createdAt)}</td><td className="font-medium">{money(x.amount)}</td><td>{t(`method.${x.method}`)}</td><td className="text-xs text-slate-500">{x.manager?.name}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>

      {staff && p.leads.length > 0 && (
        <section className="card">
          <h2 className="h2">{t("nav.leads")}</h2>
          <ul className="text-sm">
            {p.leads.map((l) => (
              <li key={l.id} className="flex gap-2 py-1">
                <Link className="link" href={`/leads/${l.id}`}>#{l.id}</Link>
                <StatusBadge status={l.status} label={t(`status.${l.status}`)} />
                <span className="text-slate-500">{t(`source.${l.source}`)} · {dateOnly(l.createdAt)} · {l.manager?.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
