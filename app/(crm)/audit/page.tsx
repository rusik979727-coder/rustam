import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { dt } from "@/lib/format";

export default async function AuditPage() {
  await requireUser(["HEAD_MANAGER"]);
  const { t } = await getT();
  const logs = await db.auditLog.findMany({ include: { user: true }, orderBy: { createdAt: "desc" }, take: 300 });
  return (
    <div className="space-y-4">
      <h1 className="h1">{t("audit.title")}</h1>
      <section className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>{t("common.date")}</th><th>{t("audit.user")}</th><th>{t("audit.entity")}</th><th>{t("audit.action")}</th><th></th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="whitespace-nowrap">{dt(l.createdAt)}</td>
                <td>{l.user?.name ?? "⚙ auto"}</td>
                <td>{l.entity}{l.entityId ? ` #${l.entityId}` : ""}</td>
                <td>{l.action}</td>
                <td className="max-w-md truncate font-mono text-xs text-slate-500" title={l.details ?? ""}>{l.details}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
