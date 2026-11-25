import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Мониторинг үшін (UptimeRobot т.б.): сервер мен дерекқор жұмыс істей ме */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
