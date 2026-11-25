import { NextResponse, type NextRequest } from "next/server";
import { runFrequent, sendDailyReport } from "@/lib/automations";
import { safeEqual } from "@/lib/security";

/**
 * Сыртқы планировщик (Vercel Cron, cron-job.org, systemd) үшін.
 * GET /api/cron?job=frequent|daily   Authorization: Bearer CRON_SECRET  (немесе ?secret=)
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace("Bearer ", "") ?? req.nextUrl.searchParams.get("secret");
  if (!safeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const job = req.nextUrl.searchParams.get("job") ?? "frequent";
  if (job === "daily") return NextResponse.json({ ok: await sendDailyReport() });
  return NextResponse.json(await runFrequent());
}
