import Link from "next/link";
import { requireUser, isHead } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { db } from "@/lib/db";
import { dt, toLocalInput, startOfDay } from "@/lib/format";
import { Field, Select, Empty } from "@/components/ui";
import { createTask, toggleTask } from "../actions";

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ who?: string; done?: string }> }) {
  const user = await requireUser();
  const { t } = await getT();
  const sp = await searchParams;
  const head = isHead(user);
  const users = head ? await db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [];
  const assigneeId = head ? (sp.who === "all" ? undefined : sp.who ? Number(sp.who) : undefined) : user.id;
  const tasks = await db.task.findMany({
    where: { ...(assigneeId ? { assigneeId } : {}), done: sp.done === "1" },
    include: { assignee: true, lead: true },
    orderBy: { dueAt: sp.done === "1" ? "desc" : "asc" },
    take: 300,
  });
  const today = startOfDay(new Date());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="h1">{t("tasks.title")}</h1>
        <form className="flex gap-2">
          {head && <Select name="who" defaultValue={sp.who ?? "all"} className="input w-48" label={t("tasks.assignee")} options={[{ value: "all", label: t("common.all") }, ...users.map((u) => ({ value: u.id, label: u.name }))]} />}
          <Select name="done" defaultValue={sp.done ?? "0"} className="input w-36" label={t("tasks.show")} options={[{ value: "0", label: t("tasks.open") }, { value: "1", label: t("tasks.done") }]} />
          <button className="btn-ghost">{t("common.filter")}</button>
        </form>
      </div>
      <details className="card">
        <summary className="cursor-pointer font-medium text-brand-700">+ {t("tasks.new")}</summary>
        <form action={createTask} className="mt-3 grid gap-3 md:grid-cols-4">
          <Field label={t("tasks.title")}><input name="title" className="input" required /></Field>
          <Field label={t("tasks.due")}><input type="datetime-local" name="dueAt" defaultValue={toLocalInput(new Date())} className="input" /></Field>
          {head && <Field label={t("tasks.assignee")}><Select name="assigneeId" defaultValue={user.id} options={users.map((u) => ({ value: u.id, label: u.name }))} /></Field>}
          <div className="flex items-end"><button className="btn">{t("common.create")}</button></div>
        </form>
      </details>
      <section className="card overflow-x-auto">
        {tasks.length === 0 ? <Empty text={t("common.empty")} /> : (
          <table className="table">
            <thead><tr><th></th><th>{t("tasks.title")}</th><th>{t("tasks.due")}</th>{head && <th>{t("tasks.assignee")}</th>}<th></th></tr></thead>
            <tbody>
              {tasks.map((x) => (
                <tr key={x.id}>
                  <td><form action={toggleTask}><input type="hidden" name="id" value={x.id} /><button className="btn-ghost btn-sm" aria-label={t("tasks.done")}>{x.done ? "↺" : "✓"}</button></form></td>
                  <td className={!x.done && x.dueAt < today ? "text-red-600" : ""}>
                    {x.title}
                    <div className="text-xs text-slate-500">{t(`tasks.kind.${x.kind}`)}</div>
                  </td>
                  <td className="whitespace-nowrap">{dt(x.dueAt)}</td>
                  {head && <td>{x.assignee.name}</td>}
                  <td className="whitespace-nowrap text-xs">
                    {x.lead && <Link className="link" href={`/leads/${x.lead.id}`}>{t("nav.leads")} #{x.lead.id}</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
