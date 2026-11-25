import { NextResponse, type NextRequest } from "next/server";
import { createIncomingLead } from "@/lib/leads";
import { safeEqual } from "@/lib/security";

/**
 * Сайт / Tilda / 2GIS / кез келген форма үшін әмбебап webhook.
 * POST /api/webhooks/lead?secret=WEBHOOK_SECRET&source=SITE
 * Дене: JSON немесе form-urlencoded — name, phone, complaint, comment, source.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET;
  const given = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret");
  if (!safeEqual(given, secret)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, string> = {};
  const ct = req.headers.get("content-type") || "";
  if (Number(req.headers.get("content-length") || 0) > 100_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  if (ct.includes("application/json")) body = await req.json();
  else {
    const fd = await req.formData();
    fd.forEach((v, k) => (body[k.toLowerCase()] = String(v)));
  }
  // Tilda тест сұрауы
  if (body.test === "test") return NextResponse.json({ ok: true });

  const phone = body.phone || body.Phone || body.tel || "";
  if (!phone) return NextResponse.json({ error: "phone required" }, { status: 400 });

  const { lead, duplicate } = await createIncomingLead({
    name: String(body.name || body.Name || "").slice(0, 120),
    phone,
    source: (body.source || req.nextUrl.searchParams.get("source") || "SITE").toUpperCase(),
    complaint: body.complaint,
    comment: String(body.comment || body.message || body.Textarea || "").slice(0, 2000),
  });
  return NextResponse.json({ ok: true, leadId: lead.id, duplicate });
}
