import { headers } from "next/headers";
import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/constants";
import { money, monthKey } from "@/lib/format";
import { integrations } from "@/lib/notify";
import { Select } from "@/components/ui";
import { saveUser, savePlan } from "../actions";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ pw?: string }> }) {
  await requireUser(["HEAD_MANAGER"]);
  const sp = await searchParams;
  const { t } = await getT();
  const [users, plans] = await Promise.all([
    db.user.findMany({ orderBy: [{ role: "asc" }, { name: "asc" }] }),
    db.monthlyPlan.findMany({ include: { manager: true }, orderBy: [{ month: "desc" }] }),
  ]);
  const managers = users.filter((u) => u.role === "MANAGER" && u.active);
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const integ = integrations();
  const roleOpts = ROLES.map((r) => ({ value: r, label: t(`role.${r}`) }));

  return (
    <div className="space-y-6">
      <h1 className="h1">{t("settings.title")}</h1>
      {sp.pw && <div className="card border-red-300 bg-red-50 text-sm text-red-700" role="alert">{t("settings.pwWeak")}</div>}

      {/* Жоспар */}
      <section className="card overflow-x-auto">
        <h2 className="h2">{t("settings.plans")}</h2>
        <form action={savePlan} className="mb-3 grid gap-2 md:grid-cols-6">
          <input type="month" name="month" defaultValue={monthKey(new Date())} className="input" required aria-label={t("settings.month")} />
          <Select name="managerId" label={t("common.manager")} options={[{ value: "", label: t("settings.clinicWide") }, ...managers.map((m) => ({ value: m.id, label: m.name }))]} />
          <input type="number" name="leads" placeholder={t("dash.planLeads")} className="input" min={0} aria-label={t("dash.planLeads")} />
          <input type="number" name="bookings" placeholder={t("dash.planBookings")} className="input" min={0} aria-label={t("dash.planBookings")} />
          <input type="number" name="revenue" placeholder={t("dash.planRevenue")} className="input" min={0} step="any" aria-label={t("dash.planRevenue")} />
          <button className="btn">{t("common.save")}</button>
        </form>
        <table className="table">
          <thead><tr><th>{t("settings.month")}</th><th>{t("common.manager")}</th><th>{t("dash.planLeads")}</th><th>{t("dash.planBookings")}</th><th>{t("dash.planRevenue")}</th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}><td>{p.month}</td><td>{p.manager?.name ?? t("settings.clinicWide")}</td><td>{p.leads}</td><td>{p.bookings}</td><td>{money(p.revenue)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Қызметкерлер */}
      <section className="card overflow-x-auto">
        <h2 className="h2">{t("settings.users")}</h2>
        <table className="table">
          <thead><tr><th>{t("common.name")}</th><th>{t("settings.login")}</th><th>{t("settings.role")}</th><th>{t("settings.password")}</th><th>{t("settings.active")}</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td colSpan={6} className="p-0">
                  <form action={saveUser} className="grid grid-cols-6 items-center gap-2 px-2 py-1">
                    <input type="hidden" name="id" value={u.id} />
                    <input name="name" defaultValue={u.name} className="input" aria-label={t("common.name")} />
                    <input name="login" defaultValue={u.login} className="input" aria-label={t("settings.login")} />
                    <Select name="role" defaultValue={u.role} options={roleOpts} label={t("settings.role")} />
                    <input name="password" type="password" placeholder="••••••" minLength={8} className="input" aria-label={t("settings.password")} autoComplete="new-password" />
                    <input type="checkbox" name="active" defaultChecked={u.active} aria-label={t("settings.active")} />
                    <button className="btn-ghost btn-sm">{t("common.save")}</button>
                  </form>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={6} className="p-0">
                <form action={saveUser} className="grid grid-cols-6 items-center gap-2 bg-brand-50 px-2 py-2">
                  <input name="name" placeholder={t("common.name")} className="input" required />
                  <input name="login" placeholder={t("settings.login")} className="input" required />
                  <Select name="role" defaultValue="MANAGER" options={roleOpts} label={t("settings.role")} />
                  <input name="password" type="password" placeholder={t("settings.password")} minLength={8} className="input" required autoComplete="new-password" />
                  <span />
                  <button className="btn btn-sm">{t("common.add")}</button>
                </form>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* Интеграциялар */}
      <section className="card space-y-2 text-sm">
        <h2 className="h2">{t("settings.integrations")}</h2>
        <ul className="grid gap-1 md:grid-cols-2">
          {([
            ["Telegram (бас менеджерге есеп / эскалация)", integ.telegram],
            ["WhatsApp Business API", integ.whatsapp],
            ["SMS (Mobizon)", integ.sms],
            ["Webhook (сайт / Tilda / 2GIS)", integ.webhook],
            ["Cron API", integ.cron],
          ] as const).map(([n, on]) => (
            <li key={n} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>{n}</span>
              <span className={on ? "font-medium text-emerald-700" : "text-slate-400"}>{on ? `✓ ${t("settings.on")}` : t("settings.off")}</span>
            </li>
          ))}
        </ul>
        <p className="pt-2 text-slate-500">{t("settings.webhookHelp")}</p>
        <code className="block overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">
          POST {origin}/api/webhooks/lead?secret=WEBHOOK_SECRET&amp;source=SITE{"\n"}
        </code>
        <code className="block overflow-x-auto rounded bg-slate-900 p-2 text-xs text-slate-100">WhatsApp: {origin}/api/webhooks/whatsapp · Instagram: {origin}/api/webhooks/instagram</code>
      </section>
    </div>
  );
}
