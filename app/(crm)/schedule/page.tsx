import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { canAccessPatient } from "@/lib/access";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { addDays, startOfDay, ymd, time, toLocalInput } from "@/lib/format";
import { APPT_STATUSES } from "@/lib/constants";
import { Field, Select } from "@/components/ui";
import { createAppointment, setAppointmentStatus } from "../actions";

const DAY_START = 8; // 08:00
const DAY_END = 20; // 20:00
const PX_PER_MIN = 1.2;

const TONE: Record<string, string> = {
  BOOKED: "border-amber-400 bg-amber-50",
  CONFIRMED: "border-indigo-400 bg-indigo-50",
  ARRIVED: "border-emerald-500 bg-emerald-50",
  NO_SHOW: "border-red-400 bg-red-50",
  CANCELLED: "border-slate-300 bg-slate-50 opacity-60",
};

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ d?: string; patient?: string; error?: string }> }) {
  const user = await requireUser();
  const { t, locale } = await getT();
  const sp = await searchParams;
  const day = sp.d ? startOfDay(new Date(sp.d)) : startOfDay(new Date());
  const next = addDays(day, 1);
  const isDoctor = user.role === "DOCTOR";

  const [doctors, services, appts, patient, recentPatients] = await Promise.all([
    db.doctor.findMany({ where: { active: true, ...(isDoctor ? { id: user.doctor?.id ?? -1 } : {}) }, orderBy: { name: "asc" } }),
    db.service.findMany({ where: { active: true }, orderBy: { id: "asc" } }),
    db.appointment.findMany({ where: { startAt: { gte: day, lt: next }, ...(isDoctor ? { doctorId: user.doctor?.id ?? -1 } : {}) }, include: { patient: true, service: true }, orderBy: { startAt: "asc" } }),
    sp.patient && (await canAccessPatient(user, Number(sp.patient)))
      ? db.patient.findUnique({ where: { id: Number(sp.patient) }, include: { courses: { where: { status: "ACTIVE" } } } })
      : null,
    db.patient.findMany({
      where: isDoctor ? { OR: [{ appointments: { some: { doctorId: user.doctor?.id ?? -1 } } }, { courses: { some: { doctorId: user.doctor?.id ?? -1 } } }] } : {},
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { id: true, fullName: true, phone: true },
    }),
  ]);
  const svcName = (s: { nameKk: string; nameRu: string }) => (locale === "ru" ? s.nameRu : s.nameKk);
  const hours = Array.from({ length: DAY_END - DAY_START }, (_, i) => DAY_START + i);
  const defaultStart = new Date(day);
  defaultStart.setHours(Math.max(DAY_START, Math.min(DAY_END - 1, new Date().getHours() + 1)), 0, 0, 0);
  const backUrl = `/schedule?d=${ymd(day)}${sp.patient ? `&patient=${sp.patient}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{t("sched.title")}</h1>
        <div className="flex items-center gap-2">
          <Link className="btn-ghost" href={`/schedule?d=${ymd(addDays(day, -1))}${sp.patient ? `&patient=${sp.patient}` : ""}`}>{t("common.prev")}</Link>
          <form className="flex gap-2">
            {sp.patient && <input type="hidden" name="patient" value={sp.patient} />}
            <input type="date" name="d" defaultValue={ymd(day)} className="input" aria-label={t("common.date")} />
            <button className="btn-ghost">OK</button>
          </form>
          <Link className="btn-ghost" href={`/schedule?d=${ymd(addDays(day, 1))}${sp.patient ? `&patient=${sp.patient}` : ""}`}>{t("common.next")}</Link>
        </div>
      </div>

      {sp.error === "conflict" && <div className="card border-red-300 bg-red-50 text-sm text-red-700">{t("sched.conflict")}</div>}

      <details className="card" open={!!sp.patient}>
        <summary className="cursor-pointer font-medium text-brand-700">+ {t("sched.new")}{patient ? `: ${patient.fullName}` : ""}</summary>
        <form action={createAppointment} className="mt-3 grid gap-3 md:grid-cols-3 lg:grid-cols-6">
          <input type="hidden" name="back" value={backUrl} />
          <Field label={t("common.patient")}>
            <Select name="patientId" required defaultValue={patient?.id} options={[...(patient ? [] : [{ value: "", label: "—" }]), ...(patient && !recentPatients.some((r) => r.id === patient.id) ? [{ value: patient.id, label: patient.fullName }] : []), ...recentPatients.map((r) => ({ value: r.id, label: `${r.fullName} · ${r.phone}` }))]} />
          </Field>
          <Field label={t("common.doctor")}><Select name="doctorId" required options={doctors.map((d) => ({ value: d.id, label: `${d.name} (${d.specialty})` }))} /></Field>
          <Field label={t("common.service")}><Select name="serviceId" required options={services.map((s) => ({ value: s.id, label: `${svcName(s)} · ${s.durationMin}′` }))} /></Field>
          <Field label={t("sched.start")}><input type="datetime-local" name="startAt" step={900} defaultValue={toLocalInput(defaultStart)} className="input" required /></Field>
          <Field label={t("sched.course")}><Select name="courseId" options={[{ value: "", label: "—" }, ...(patient?.courses ?? []).map((c) => ({ value: c.id, label: `${c.title} (${c.doneSessions}/${c.totalSessions})` }))]} /></Field>
          <Field label={t("common.comment")}><input name="comment" className="input" /></Field>
          <div className="md:col-span-3 lg:col-span-6"><button className="btn">{t("common.save")}</button></div>
        </form>
      </details>

      <div className="card overflow-x-auto p-0">
        <div className="flex min-w-max">
          <div className="sticky left-0 z-10 w-14 shrink-0 border-r border-slate-200 bg-white">
            <div className="h-10 border-b border-slate-200" />
            <div className="relative" style={{ height: (DAY_END - DAY_START) * 60 * PX_PER_MIN }}>
              {hours.map((h) => (
                <div key={h} className="absolute right-1 text-[11px] text-slate-400" style={{ top: (h - DAY_START) * 60 * PX_PER_MIN - 6 }}>{String(h).padStart(2, "0")}:00</div>
              ))}
            </div>
          </div>
          {doctors.map((d) => {
            const list = appts.filter((a) => a.doctorId === d.id);
            return (
              <div key={d.id} className="w-56 shrink-0 border-r border-slate-100">
                <div className="flex h-10 flex-col justify-center border-b border-slate-200 px-2 text-sm">
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="truncate text-[11px] text-slate-500">{d.specialty}{d.room ? ` · ${d.room}` : ""}</span>
                </div>
                <div className="relative" style={{ height: (DAY_END - DAY_START) * 60 * PX_PER_MIN }}>
                  {hours.map((h) => <div key={h} className="absolute inset-x-0 border-t border-slate-100" style={{ top: (h - DAY_START) * 60 * PX_PER_MIN }} />)}
                  {list.map((a) => {
                    const top = ((a.startAt.getHours() - DAY_START) * 60 + a.startAt.getMinutes()) * PX_PER_MIN;
                    const h = Math.max(28, ((a.endAt.getTime() - a.startAt.getTime()) / 60000) * PX_PER_MIN);
                    return (
                      <div key={a.id} className={`absolute inset-x-1 overflow-hidden rounded-md border-l-4 px-1.5 py-1 text-[11px] shadow-sm ${TONE[a.status]}`} style={{ top, height: h }}>
                        <div className="flex justify-between gap-1">
                          <Link href={`/patients/${a.patientId}`} className="truncate font-semibold text-slate-800 hover:underline">{time(a.startAt)} {a.patient.fullName}</Link>
                        </div>
                        <div className="truncate text-slate-600">{svcName(a.service)}</div>
                        {h >= 50 && (
                          <form action={setAppointmentStatus} className="mt-0.5 flex gap-1">
                            <input type="hidden" name="id" value={a.id} />
                            <select name="status" defaultValue={a.status} className="min-w-0 flex-1 rounded border border-slate-200 bg-white text-[10px]" aria-label={t("common.status")}>
                              {APPT_STATUSES.map((s) => <option key={s} value={s}>{t(`appt.${s}`)}</option>)}
                            </select>
                            <button className="rounded bg-white px-1 text-[10px] ring-1 ring-slate-200">OK</button>
                          </form>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-slate-500">
        {APPT_STATUSES.map((s) => <span key={s} className={`rounded border-l-4 px-2 py-0.5 ${TONE[s]}`}>{t(`appt.${s}`)}</span>)}
      </div>
    </div>
  );
}
