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

/** Бас менеджерге: өтінімдер экспорты /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(req: NextRequest) {
  const u = await currentUser();
  if (!u || u.role !== "HEAD_MANAGER") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const p = req.nextUrl.searchParams;
  const from = p.get("from") ? new Date(p.get("from")!) : new Date(0);
  const to = p.get("to") ? new Date(new Date(p.get("to")!).getTime() + 86400000) : new Date("2100-01-01");
  const d = (x: Date | null) => (x ? x.toLocaleString("ru-RU") : "");

  const xs = await db.lead.findMany({ where: { createdAt: { gte: from, lt: to } }, include: { manager: true }, orderBy: { createdAt: "asc" } });
  const rows: (string | number | null)[][] = [
    ["ID", "Күні", "Аты", "Телефон", "Дереккөз", "Шағым", "Статус", "Менеджер", "Конс", "Расталды", "Сома", "Төлеген күні", "Бас тарту себебі", "Пікір"],
    ...xs.map((x) => [
      x.id, d(x.createdAt), x.name, x.phone, x.source, x.complaint, x.status, x.manager?.name ?? "",
      d(x.consultAt), x.consultConfirmedAt ? "иә" : "", x.amount, d(x.paidAt), x.lostReason, x.comment,
    ]),
  ];
  await audit(u.id, "Export", null, "leads", { from: p.get("from"), to: p.get("to"), rows: rows.length - 1 });
  return new NextResponse(csv(rows), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="beles-leads.csv"`, "cache-control": "private, no-store" },
  });
}
