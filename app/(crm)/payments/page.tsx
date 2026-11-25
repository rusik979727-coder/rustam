import Link from "next/link";
import { requireUser, isHead } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { addDays, startOfDay, ymd, money, dt } from "@/lib/format";
import { PAYMENT_METHODS } from "@/lib/constants";
import { debtors } from "@/lib/debts";
import { Stat, Empty } from "@/components/ui";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const user = await requireUser(["HEAD_MANAGER", "MANAGER"]);
  const { t } = await getT();
  const sp = await searchParams;
  const from = sp.from ? startOfDay(new Date(sp.from)) : startOfDay(new Date());
  const to = sp.to ? addDays(startOfDay(new Date(sp.to)), 1) : addDays(from, 1);
  const head = isHead(user);

  const [payments, debts] = await Promise.all([
    db.payment.findMany({
      where: { createdAt: { gte: from, lt: to }, ...(head ? {} : { managerId: user.id }) },
      include: { patient: true, manager: true, course: true },
      orderBy: { createdAt: "desc" },
    }),
    debtors(30),
  ]);
  const total = payments.reduce((s, p) => s + p.amount, 0);
  const byMethod = PAYMENT_METHODS.map((m) => ({ m, sum: payments.filter((p) => p.method === m).reduce((s, p) => s + p.amount, 0) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">{t("pay.title")}</h1>
        <form className="flex flex-wrap items-end gap-2">
          <label><span className="label">{t("common.from")}</span><input type="date" name="from" defaultValue={ymd(from)} className="input" /></label>
          <label><span className="label">{t("common.to")}</span><input type="date" name="to" defaultValue={ymd(addDays(to, -1))} className="input" /></label>
          <button className="btn-ghost">{t("common.filter")}</button>
          {head && <a className="btn-ghost" href={`/api/export?type=payments&from=${ymd(from)}&to=${ymd(addDays(to, -1))}`}>{t("common.export")}</a>}
        </form>
      </div>
      <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={t("common.total")} value={money(total)} tone="good" />
        {byMethod.map((x) => <Stat key={x.m} label={t(`method.${x.m}`)} value={money(x.sum)} />)}
      </section>
      <p className="text-sm text-slate-500">{t("pay.new")}: {t("nav.patients")} → {t("patients.payments")}</p>
      <div className="grid gap-4 xl:grid-cols-3">
        <section className="card overflow-x-auto xl:col-span-2">
          <h2 className="h2">{t("pay.list")} ({payments.length})</h2>
          {payments.length === 0 ? <Empty text={t("common.empty")} /> : (
            <table className="table">
              <thead><tr><th>{t("common.date")}</th><th>{t("common.patient")}</th><th>{t("common.amount")}</th><th>{t("common.method")}</th><th>{t("patients.courses")}</th><th>{t("common.manager")}</th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="whitespace-nowrap">{dt(p.createdAt)}</td>
                    <td><Link className="link" href={`/patients/${p.patientId}`}>{p.patient.fullName}</Link></td>
                    <td className="whitespace-nowrap font-medium">{money(p.amount)}</td>
                    <td>{t(`method.${p.method}`)}</td>
                    <td className="text-slate-500">{p.course?.title ?? "—"}</td>
                    <td className="text-slate-500">{p.manager?.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2 className="h2">{t("pay.debtors")}</h2>
          {debts.length === 0 ? <Empty text={t("common.empty")} /> : (
            <table className="table"><tbody>
              {debts.map((d) => (
                <tr key={d.id}><td><Link className="link" href={`/patients/${d.id}`}>{d.fullName}</Link><div className="text-xs text-slate-500">{d.phone}</div></td><td className="whitespace-nowrap text-right font-medium text-red-600">{money(d.debt)}</td></tr>
              ))}
            </tbody></table>
          )}
        </section>
      </div>
    </div>
  );
}
