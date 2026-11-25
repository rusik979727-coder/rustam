import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { addDays, money, monthKey, pct, startOfDay, startOfMonth, ymd, dt, time } from "@/lib/format";
import { funnel, avgResponseMinutes, groupCount } from "@/lib/stats";
import { debtors } from "@/lib/debts";
import { Stat, Meter, Empty, StatusBadge } from "@/components/ui";
import { reassignLead, autoAssignUnassigned, runAutomationsNow, toggleTask } from "./actions";
import { integrations } from "@/lib/notify";

type SP = Promise<{ from?: string; to?: string; manager?: string }>;

export default async function Home({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (user.role === "HEAD_MANAGER") return <HeadDashboard searchParams={searchParams} />;
  return <MyDay />;
}

/* ===================== Бас менеджер панелі ===================== */

async function HeadDashboard({ searchParams }: { searchParams: SP }) {
  const { t, locale } = await getT();
  const sp = await searchParams;
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const from = sp.from ? startOfDay(new Date(sp.from)) : startOfMonth(now);
  const to = sp.to ? addDays(startOfDay(new Date(sp.to)), 1) : tomorrow;
  const escMin = Number(process.env.ESCALATION_MINUTES || 15);

  const [managers, periodLeads, todayLeads, unanswered, todayAppts, todayRev, periodPayments, overdueTasks, unassigned, plan, debts] =
    await Promise.all([
      db.user.findMany({ where: { role: { in: ["MANAGER", "HEAD_MANAGER"] }, active: true }, orderBy: { name: "asc" } }),
      db.lead.findMany({ where: { createdAt: { gte: from, lt: to } } }),
      db.lead.count({ where: { createdAt: { gte: today } } }),
      db.lead.findMany({
        where: { status: "NEW", firstResponseAt: null, createdAt: { lt: new Date(now.getTime() - escMin * 60000) } },
        include: { manager: true },
        orderBy: { createdAt: "asc" },
        take: 10,
      }),
      db.appointment.findMany({ where: { startAt: { gte: today, lt: tomorrow } } }),
      db.payment.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: today } } }),
      db.payment.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { amount: true, managerId: true, patientId: true } }),
      db.task.findMany({ where: { done: false, dueAt: { lt: today } }, select: { assigneeId: true } }),
      db.lead.findMany({ where: { managerId: null, status: { notIn: ["PAID", "LOST"] } }, orderBy: { createdAt: "asc" }, take: 20 }),
      db.monthlyPlan.findFirst({ where: { month: monthKey(now), managerId: null } }),
      debtors(8),
    ]);

  const monthFrom = startOfMonth(now);
  const [monthLeads, monthRev] = await Promise.all([
    db.lead.findMany({ where: { createdAt: { gte: monthFrom } }, select: { status: true } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: monthFrom } } }),
  ]);
  const monthBooked = await db.appointment.count({ where: { createdAt: { gte: monthFrom }, status: { not: "CANCELLED" } } });

  const periodRevenue = periodPayments.reduce((s, p) => s + p.amount, 0);
  const f = funnel(periodLeads);
  const noShow = todayAppts.filter((a) => a.status === "NO_SHOW").length;

  const teamRows = managers
    .map((m) => {
      const ml = periodLeads.filter((l) => l.managerId === m.id);
      const mf = funnel(ml);
      return {
        m,
        leads: mf.total,
        booked: mf.booked,
        paid: mf.paid,
        conv: mf.convBooked,
        resp: avgResponseMinutes(ml),
        revenue: periodPayments.filter((p) => p.managerId === m.id).reduce((s, p) => s + p.amount, 0),
        overdue: overdueTasks.filter((x) => x.assigneeId === m.id).length,
      };
    })
    .filter((r) => r.m.role === "MANAGER" || r.leads > 0 || r.revenue > 0)
    .sort((a, b) => b.revenue - a.revenue || b.booked - a.booked);

  const sources = groupCount(periodLeads, (l) => l.source).map(([src, n]) => {
    const sl = periodLeads.filter((l) => l.source === src);
    const sf = funnel(sl);
    return { src, n, booked: sf.booked, paid: sf.paid, conv: sf.convPaid };
  });
  const lost = groupCount(periodLeads.filter((l) => l.status === "LOST"), (l) => l.lostReason ?? "OTHER");
  const integ = integrations();
  const managerOpts = managers.filter((m) => m.role === "MANAGER");
  const qs = `from=${ymd(from)}&to=${ymd(addDays(to, -1))}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="h1">{t("dash.title")}</h1>
        <form className="flex flex-wrap items-end gap-2">
          <label><span className="label">{t("common.from")}</span><input type="date" name="from" defaultValue={ymd(from)} className="input" /></label>
          <label><span className="label">{t("common.to")}</span><input type="date" name="to" defaultValue={ymd(addDays(to, -1))} className="input" /></label>
          <button className="btn-ghost">{t("common.filter")}</button>
        </form>
      </div>

      {/* Бүгінгі жағдай */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label={t("dash.newLeads")} value={todayLeads} hint={t("common.today")} />
        <Stat label={t("dash.unanswered", { m: escMin })} value={unanswered.length} tone={unanswered.length ? "alert" : "default"} />
        <Stat label={t("dash.todayAppts")} value={todayAppts.filter((a) => a.status !== "CANCELLED").length} />
        <Stat label={t("dash.noShow")} value={noShow} tone={noShow ? "alert" : "default"} />
        <Stat label={t("dash.todayRevenue")} value={money(todayRev._sum.amount ?? 0)} tone="good" />
        <Stat label={t("dash.periodRevenue")} value={money(periodRevenue)} />
      </section>

      {unanswered.length > 0 && (
        <section className="card border-red-200">
          <h2 className="h2 text-red-700">{t("dash.unanswered", { m: escMin })}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {unanswered.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/leads/${l.id}`} className="link">{l.name} · {l.phone}</Link>
                <span className="text-slate-500">{l.manager?.name ?? t("common.unassigned")} · {dt(l.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Команда */}
        <section className="card overflow-x-auto xl:col-span-2">
          <h2 className="h2">{t("dash.team")}</h2>
          <table className="table">
            <thead>
              <tr>
                <th>#</th><th>{t("common.manager")}</th><th>{t("dash.leads")}</th><th>{t("dash.booked")}</th><th>{t("dash.paid")}</th>
                <th>{t("dash.conv")}</th><th>{t("dash.response")}</th><th>{t("dash.revenue")}</th><th>{t("dash.overdue")}</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((r, i) => (
                <tr key={r.m.id}>
                  <td>{i + 1}</td>
                  <td className="font-medium">{r.m.name}</td>
                  <td>{r.leads}</td>
                  <td>{r.booked}</td>
                  <td>{r.paid}</td>
                  <td>{r.conv}%</td>
                  <td className={r.resp != null && r.resp > escMin ? "font-semibold text-red-600" : ""}>{r.resp ?? "—"}</td>
                  <td className="whitespace-nowrap">{money(r.revenue)}</td>
                  <td className={r.overdue ? "font-semibold text-red-600" : ""}>{r.overdue}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td></td><td>{t("common.total")}</td><td>{f.total}</td><td>{f.booked}</td><td>{f.paid}</td><td>{f.convBooked}%</td>
                <td>{avgResponseMinutes(periodLeads) ?? "—"}</td><td className="whitespace-nowrap">{money(periodRevenue)}</td><td>{overdueTasks.length}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Жоспар / факт */}
        <section className="card space-y-4">
          <h2 className="h2">{t("dash.plan", { month: monthKey(now) })}</h2>
          {plan ? (
            <>
              <Meter label={t("dash.planLeads")} fact={monthLeads.length} plan={plan.leads} />
              <Meter label={t("dash.planBookings")} fact={monthBooked} plan={plan.bookings} />
              <Meter label={t("dash.planRevenue")} fact={monthRev._sum.amount ?? 0} plan={plan.revenue} format={money} />
            </>
          ) : (
            <p className="text-sm text-slate-500">{t("dash.noPlan")} → <Link href="/settings" className="link">{t("nav.settings")}</Link></p>
          )}
          <div className="border-t border-slate-100 pt-3">
            <h2 className="h2">{t("dash.funnel")}</h2>
            <table className="table">
              <tbody>
                {[["dash.leads", f.total], ["status.BOOKED", f.booked], ["status.ARRIVED", f.arrived], ["status.PAID", f.paid], ["status.LOST", f.lost]].map(([k, v]) => (
                  <tr key={k as string}><td>{t(k as string)}</td><td className="text-right font-medium">{v as number}</td><td className="w-14 text-right text-slate-500">{pct(v as number, f.total)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {/* Тағайындалмаған */}
        <section className="card">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="h2 mb-0">{t("dash.unassignedLeads")} ({unassigned.length})</h2>
            {unassigned.length > 0 && (
              <form action={autoAssignUnassigned}><button className="btn btn-sm">{t("dash.autoAssign")}</button></form>
            )}
          </div>
          {unassigned.length === 0 ? <Empty text={t("common.empty")} /> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {unassigned.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                  <Link href={`/leads/${l.id}`} className="link truncate">{l.name}</Link>
                  <form action={reassignLead} className="flex gap-1">
                    <input type="hidden" name="id" value={l.id} />
                    <select name="managerId" className="input py-1 text-xs" aria-label={t("leads.reassign")}>
                      {managerOpts.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                    <button className="btn-ghost btn-sm">OK</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Дереккөздер */}
        <section className="card overflow-x-auto">
          <h2 className="h2">{t("dash.sources")}</h2>
          {sources.length === 0 ? <Empty text={t("common.empty")} /> : (
            <table className="table">
              <thead><tr><th>{t("leads.source")}</th><th>{t("dash.leads")}</th><th>{t("dash.booked")}</th><th>{t("dash.paid")}</th><th>{t("dash.conv")}</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.src}><td>{t(`source.${s.src}`)}</td><td>{s.n}</td><td>{s.booked}</td><td>{s.paid}</td><td>{s.conv}%</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <h2 className="h2 mt-4">{t("dash.lostReasons")}</h2>
          {lost.length === 0 ? <Empty text={t("common.empty")} /> : (
            <table className="table"><tbody>
              {lost.map(([r, n]) => <tr key={r}><td>{t(`lost.${r}`)}</td><td className="text-right font-medium">{n}</td></tr>)}
            </tbody></table>
          )}
        </section>

        {/* Қарыздар */}
        <section className="card">
          <h2 className="h2">{t("dash.debtors")}</h2>
          {debts.length === 0 ? <Empty text={t("common.empty")} /> : (
            <table className="table"><tbody>
              {debts.map((d) => (
                <tr key={d.id}><td><Link href={`/patients/${d.id}`} className="link">{d.fullName}</Link><div className="text-xs text-slate-500">{d.phone}</div></td><td className="whitespace-nowrap text-right font-medium text-red-600">{money(d.debt)}</td></tr>
              ))}
            </tbody></table>
          )}
        </section>
      </div>

      <section className="card flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">{t("common.export")}:</span>
        <a className="btn-ghost btn-sm" href={`/api/export?type=leads&${qs}`}>{t("nav.leads")}</a>
        <a className="btn-ghost btn-sm" href={`/api/export?type=payments&${qs}`}>{t("pay.list")}</a>
        <a className="btn-ghost btn-sm" href={`/api/export?type=patients`}>{t("nav.patients")}</a>
        <span className="mx-2 hidden h-5 w-px bg-slate-200 md:block" />
        <form action={runAutomationsNow}><button className="btn-ghost btn-sm">⚙ {t("dash.runAutomations")}</button></form>
        <span className="text-xs text-slate-500">
          Telegram: {integ.telegram ? "✓" : "✗"} · WhatsApp: {integ.whatsapp ? "✓" : "✗"} · SMS: {integ.sms ? "✓" : "✗"}
        </span>
        <span className="sr-only">{locale}</span>
      </section>
    </div>
  );
}

/* ===================== Менеджер / дәрігер күні ===================== */

async function MyDay() {
  const user = await requireUser();
  const { t } = await getT();
  const now = new Date();
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const monthFrom = startOfMonth(now);
  const isDoctor = user.role === "DOCTOR";

  const [calls, tasks, appts, monthLeads, monthRev, plan] = await Promise.all([
    isDoctor ? [] : db.lead.findMany({
      where: {
        managerId: user.id,
        status: { in: ["NEW", "CONTACTED", "BOOKED", "ARRIVED"] },
        OR: [{ nextContactAt: { lt: tomorrow } }, { status: "NEW" }],
      },
      orderBy: [{ nextContactAt: "asc" }, { createdAt: "asc" }],
    }),
    db.task.findMany({ where: { assigneeId: user.id, done: false }, orderBy: { dueAt: "asc" }, take: 30 }),
    db.appointment.findMany({
      where: { startAt: { gte: today, lt: tomorrow }, ...(isDoctor ? { doctorId: user.doctor?.id ?? -1 } : { managerId: user.id }) },
      include: { patient: true, doctor: true, service: true },
      orderBy: { startAt: "asc" },
    }),
    isDoctor ? [] : db.lead.findMany({ where: { managerId: user.id, createdAt: { gte: monthFrom } } }),
    db.payment.aggregate({ _sum: { amount: true }, where: { managerId: user.id, createdAt: { gte: monthFrom } } }),
    db.monthlyPlan.findFirst({ where: { month: monthKey(now), managerId: user.id } }),
  ]);
  const f = funnel(monthLeads as Awaited<ReturnType<typeof db.lead.findMany>>);

  return (
    <div className="space-y-6">
      <h1 className="h1">{t("my.title")} — {user.name}</h1>
      {!isDoctor && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t("dash.leads")} value={f.total} hint={monthKey(now)} />
          <Stat label={t("dash.booked")} value={f.booked} />
          <Stat label={t("dash.conv")} value={`${f.convBooked}%`} />
          <Stat label={t("dash.revenue")} value={money(monthRev._sum.amount ?? 0)} tone="good" />
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        {!isDoctor && (
          <section className="card">
            <h2 className="h2">{t("my.calls")} ({calls.length})</h2>
            {calls.length === 0 ? <Empty text={t("common.empty")} /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {calls.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2">
                    <div>
                      <Link href={`/leads/${l.id}`} className="link font-medium">{l.name}</Link>
                      <div className="text-xs text-slate-500">{l.phone} · {t(`complaint.${l.complaint}`)}</div>
                    </div>
                    <div className="text-right text-xs">
                      <StatusBadge status={l.status} label={t(`status.${l.status}`)} />
                      <div className={`mt-1 ${l.nextContactAt && l.nextContactAt < now ? "text-red-600" : "text-slate-500"}`}>{dt(l.nextContactAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="card">
          <h2 className="h2">{t("my.tasks")} ({tasks.length})</h2>
          {tasks.length === 0 ? <Empty text={t("common.empty")} /> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {tasks.map((x) => (
                <li key={x.id} className="flex items-center justify-between gap-2 py-2">
                  <div>
                    <div className={x.dueAt < today ? "text-red-600" : ""}>{x.title}</div>
                    <div className="text-xs text-slate-500">{t(`tasks.kind.${x.kind}`)} · {dt(x.dueAt)}</div>
                  </div>
                  <form action={toggleTask}><input type="hidden" name="id" value={x.id} /><button className="btn-ghost btn-sm">✓</button></form>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2 className="h2">{t("dash.todayAppts")} ({appts.length})</h2>
          {appts.length === 0 ? <Empty text={t("common.empty")} /> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {appts.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div><b>{time(a.startAt)}</b> <Link className="link" href={`/patients/${a.patientId}`}>{a.patient.fullName}</Link><div className="text-xs text-slate-500">{a.doctor.name} · {a.service.nameKk}</div></div>
                  <StatusBadge status={a.status} label={t(`appt.${a.status}`)} />
                </li>
              ))}
            </ul>
          )}
        </section>
        {!isDoctor && plan && (
          <section className="card space-y-4">
            <h2 className="h2">{t("my.plan")}</h2>
            <Meter label={t("dash.planLeads")} fact={f.total} plan={plan.leads} />
            <Meter label={t("dash.planBookings")} fact={f.booked} plan={plan.bookings} />
            <Meter label={t("dash.planRevenue")} fact={monthRev._sum.amount ?? 0} plan={plan.revenue} format={money} />
          </section>
        )}
      </div>
    </div>
  );
}
