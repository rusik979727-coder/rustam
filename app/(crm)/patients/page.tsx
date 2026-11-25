import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { COMPLAINTS } from "@/lib/constants";
import { patientBalance } from "@/lib/finance";
import { money, dateOnly } from "@/lib/format";
import { Select, Empty } from "@/components/ui";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string; dx?: string; debt?: string }> }) {
  const user = await requireUser();
  const { t } = await getT();
  const sp = await searchParams;
  const and: Prisma.PatientWhereInput[] = [];
  if (sp.q) and.push({ OR: [{ fullName: { contains: sp.q } }, { phone: { contains: sp.q.replace(/\D/g, "") || sp.q } }, { iin: { contains: sp.q } }] });
  if (sp.dx) and.push({ diagnosis: sp.dx });
  if (user.role === "DOCTOR") and.push({ OR: [{ appointments: { some: { doctorId: user.doctor?.id ?? -1 } } }, { courses: { some: { doctorId: user.doctor?.id ?? -1 } } }] });

  const patients = await db.patient.findMany({
    where: { AND: and },
    include: {
      courses: { select: { price: true, status: true } },
      appointments: { select: { price: true, status: true, courseId: true, startAt: true }, orderBy: { startAt: "desc" } },
      payments: { select: { amount: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  let rows = patients.map((p) => ({ p, bal: patientBalance(p), last: p.appointments[0]?.startAt }));
  if (sp.debt) rows = rows.filter((r) => r.bal.debt > 0);
  const showMoney = user.role !== "DOCTOR";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{t("patients.title")} ({rows.length})</h1>
        <div className="flex flex-wrap gap-2">
          <form className="flex flex-wrap gap-2">
            <input name="q" defaultValue={sp.q} placeholder={`${t("common.search")}: ${t("common.name")}, ${t("common.phone")}, ${t("patients.iin")}`} className="input w-72" />
            <Select name="dx" defaultValue={sp.dx} className="input w-44" label={t("patients.diagnosis")} options={[{ value: "", label: `${t("patients.diagnosis")}: ${t("common.all")}` }, ...COMPLAINTS.map((c) => ({ value: c, label: t(`complaint.${c}`) }))]} />
            {showMoney && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="debt" value="1" defaultChecked={!!sp.debt} /> {t("patients.debt")}</label>}
            <button className="btn-ghost">{t("common.filter")}</button>
          </form>
          <Link href="/patients/new" className="btn">+ {t("patients.new")}</Link>
        </div>
      </div>
      <div className="card overflow-x-auto">
        {rows.length === 0 ? <Empty text={t("common.empty")} /> : (
          <table className="table">
            <thead><tr><th>{t("common.name")}</th><th>{t("common.phone")}</th><th>{t("patients.diagnosis")}</th><th>{t("patients.mri")}</th><th>{t("patients.appointments")}</th>{showMoney && <th>{t("patients.debt")}</th>}</tr></thead>
            <tbody>
              {rows.map(({ p, bal, last }) => (
                <tr key={p.id}>
                  <td><Link className="link font-medium" href={`/patients/${p.id}`}>{p.fullName}</Link></td>
                  <td className="whitespace-nowrap">{p.phone}</td>
                  <td>{p.diagnosis ? t(`complaint.${p.diagnosis}`) : "—"}</td>
                  <td>{p.hasMri ? "✓" : "—"}</td>
                  <td className="text-slate-500">{p.appointments.length} · {dateOnly(last)}</td>
                  {showMoney && <td className={bal.debt ? "font-medium text-red-600" : "text-slate-400"}>{bal.debt ? money(bal.debt) : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
