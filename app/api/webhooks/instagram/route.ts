import { NextResponse, type NextRequest } from "next/server";
import { createIncomingLead } from "@/lib/leads";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.IG_VERIFY_TOKEN && process.env.IG_VERIFY_TOKEN)
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * Instagram Direct (Meta Graph API, messaging webhook).
 * Instagram телефон бермейді — өтінім «ig:<sender id>» идентификаторымен құрылады,
 * менеджер нөмірді сұрап, карточкада жаңартады.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  for (const e of body?.entry ?? []) {
    for (const m of e.messaging ?? []) {
      if (!m.message || m.message.is_echo) continue;
      const sender = String(m.sender?.id ?? "");
      if (!sender) continue;
      const text: string = m.message.text ?? "";
      const phoneInText = text.match(/(\+?7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-]*\d{2}[\s\-]*\d{2}/)?.[0];
      await createIncomingLead({
        name: `Instagram ${sender.slice(-6)}`,
        phone: phoneInText ?? `ig:${sender}`,
        source: "INSTAGRAM",
        comment: text,
      });
    }
  }
  return NextResponse.json({ ok: true });
}
