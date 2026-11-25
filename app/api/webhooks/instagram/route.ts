import { NextResponse, type NextRequest } from "next/server";
import { createIncomingLead } from "@/lib/leads";
import { safeEqual, verifyMetaSignature } from "@/lib/security";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  if (p.get("hub.mode") === "subscribe" && safeEqual(p.get("hub.verify_token"), process.env.IG_VERIFY_TOKEN))
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("forbidden", { status: 403 });
}

/**
 * Instagram Direct (Meta Graph API, messaging webhook).
 * Instagram телефон бермейді — өтінім «ig:<sender id>» идентификаторымен құрылады,
 * менеджер нөмірді сұрап, карточкада жаңартады.
 */
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
