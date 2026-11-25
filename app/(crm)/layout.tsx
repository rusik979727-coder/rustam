import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { Nav } from "@/components/Nav";
import { LangSwitch } from "@/components/LangSwitch";
import { logoutAction } from "@/app/actions-public";

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { t, locale } = await getT();
  const head = user.role === "HEAD_MANAGER";
  const doctor = user.role === "DOCTOR";

  const [openTasks, newLeads] = await Promise.all([
    db.task.count({ where: { assigneeId: user.id, done: false, dueAt: { lte: new Date() } } }),
    doctor ? 0 : db.lead.count({ where: { status: "NEW", ...(head ? {} : { managerId: user.id }) } }),
  ]);

  const items = [
    { href: "/", label: head ? t("nav.dashboard") : t("nav.my") },
    ...(!doctor ? [{ href: "/leads", label: t("nav.leads"), badge: newLeads }] : []),
    { href: "/patients", label: t("nav.patients") },
    { href: "/schedule", label: t("nav.schedule") },
    ...(!doctor ? [{ href: "/payments", label: t("nav.payments") }] : []),
    { href: "/tasks", label: t("nav.tasks"), badge: openTasks },
    ...(head ? [{ href: "/settings", label: t("nav.settings") }, { href: "/audit", label: t("nav.audit") }] : []),
  ];

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white p-3 md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r">
        <div className="mb-3 flex items-center justify-between md:block">
          <div className="px-2">
            <div className="text-lg font-bold text-brand-700">{t("app.title")}</div>
            <div className="text-xs text-slate-500">{t("app.clinic")}</div>
          </div>
        </div>
        <Nav items={items} />
        <div className="mt-4 space-y-2 border-t border-slate-100 px-2 pt-3 text-sm">
          <div className="font-medium">{user.name}</div>
          <div className="text-xs text-slate-500">{t(`role.${user.role}`)}</div>
          <div className="flex items-center justify-between">
            <LangSwitch locale={locale} />
            <form action={logoutAction}>
              <button className="text-xs text-slate-500 hover:text-red-600">{t("nav.logout")}</button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
