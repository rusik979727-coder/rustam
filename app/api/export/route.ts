import { NextResponse, type NextRequest } from "next/server";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvSafe } from "@/lib/security";
import { audit } from "@/lib/audit";

function csv(rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = csvSafe(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM + «;» — Excel кириллицаны дұрыс ашады
  return "﻿" + rows.map((r) => r.map(esc).join(";")).join("\r\n");
}

/** Бас менеджерге: /api/export?type=leads|payments|patients&from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: NextRequest) {
  const u = await currentUser();
  if (!u || u.role !== "HEAD_MANAGER") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const type = p.get("type") ?? "leads";
  const from = p.get("from") ? new Date(p.get("from")!) : new Date(0);
  const to = p.get("to") ? new Date(new Date(p.get("to")!).getTime() + 86400000) : new Date("2100-01-01");
  let rows: (string | number | null)[][] = [];

  if (type === "payments") {
    const xs = await db.payment.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { patient: true, manager: true }, orderBy: { createdAt: "asc" } });
    rows = [["ID", "Күні", "Пациент", "Телефон", "Сома", "Тәсілі", "Менеджер", "Пікір"], ...xs.map((x) => [x.id, x.createdAt.toLocaleString("ru-RU"), x.patient.fullName, x.patient.phone, x.amount, x.method, x.manager?.name ?? "", x.comment])];
  } else if (type === "patients") {
    const xs = await db.patient.findMany({ orderBy: { createdAt: "asc" } });
    rows = [["ID", "Аты-жөні", "Телефон", "ЖСН", "Диагноз", "МРТ", "Тіркелді"], ...xs.map((x) => [x.id, x.fullName, x.phone, x.iin, x.diagnosis, x.hasMri ? "иә" : "жоқ", x.createdAt.toLocaleDateString("ru-RU")])];
  } else {
    const xs = await db.lead.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { manager: true }, orderBy: { createdAt: "asc" } });
    rows = [["ID", "Күні", "Аты", "Телефон", "Дереккөз", "Шағым", "Статус", "Менеджер", "Бас тарту себебі"], ...xs.map((x) => [x.id, x.createdAt.toLocaleString("ru-RU"), x.name, x.phone, x.source, x.complaint, x.status, x.manager?.name ?? "", x.lostReason])];
  }
  await audit(u.id, "Export", null, type, { from: p.get("from"), to: p.get("to"), rows: rows.length - 1 });
  return new NextResponse(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="beles-${type}.csv"`, "cache-control": "private, no-store" },
  });
}
