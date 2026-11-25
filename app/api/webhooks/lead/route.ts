import { NextResponse, type NextRequest } from "next/server";
import { createIncomingLead } from "@/lib/leads";

/**
 * Сайт / Tilda / 2GIS / кез келген форма үшін әмбебап webhook.
 * POST /api/webhooks/lead?secret=WEBHOOK_SECRET&source=SITE
 * Дене: JSON немесе form-urlencoded — name, phone, complaint, comment, source.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.WEBHOOK_SECRET;
  const given = req.nextUrl.searchParams.get("secret") ?? req.headers.get("x-webhook-secret");
  if (!secret || given !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, string> = {};
  const ct = req.headers.get("content-type") || "";
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
    name: body.name || body.Name,
    phone,
    source: (body.source || req.nextUrl.searchParams.get("source") || "SITE").toUpperCase(),
    complaint: body.complaint,
    comment: body.comment || body.message || body.Textarea,
  });
  return NextResponse.json({ ok: true, leadId: lead.id, duplicate });
}
