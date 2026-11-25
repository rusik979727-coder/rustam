import { NextResponse, type NextRequest } from "next/server";
import { createIncomingLead } from "@/lib/leads";
import { safeEqual, verifyMetaSignature } from "@/lib/security";
import { handlePatientReply } from "@/lib/automations";
import { normalizePhone } from "@/lib/phone";

/** Meta webhook верификациясы */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token"), process.env.WA_VERIFY_TOKEN))
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("forbidden", { status: 403 });
}

/** WhatsApp Business Cloud API кіріс хабарламалары */
export async function POST(req: NextRequest) {
  // Meta қолтаңбасын тексеру: тек Meta-дан келген сұраулар қабылданады
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: any = {};
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const changes = body?.entry?.flatMap((e: any) => e.changes ?? []) ?? [];
  for (const ch of changes) {
    const v = ch.value ?? {};
    const names: Record<string, string> = {};
    for (const c of v.contacts ?? []) names[c.wa_id] = c.profile?.name;
    for (const m of v.messages ?? []) {
      const phone = normalizePhone(m.from);
      const text: string = m.text?.body ?? m.button?.text ?? "";
      if (await handlePatientReply(phone, text)) continue;
      await createIncomingLead({ name: names[m.from], phone, source: "WHATSAPP", comment: text });
    }
  }
  return NextResponse.json({ ok: true });
}
