import { NextResponse, type NextRequest } from "next/server";
import { createIncomingLead } from "@/lib/leads";
import { handlePatientReply } from "@/lib/automations";
import { normalizePhone } from "@/lib/phone";

/** Meta webhook верификациясы */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WA_VERIFY_TOKEN && process.env.WA_VERIFY_TOKEN)
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("forbidden", { status: 403 });
}

/** WhatsApp Business Cloud API кіріс хабарламалары */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
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
