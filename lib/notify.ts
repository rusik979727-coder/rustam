/**
 * Сыртқы хабарлама арналары. Кілт .env-те болмаса — арна өшірулі, хабар тек консольге жазылады.
 */
export const integrations = () => ({
  telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
  whatsapp: !!(process.env.WA_TOKEN && process.env.WA_PHONE_NUMBER_ID),
  sms: !!process.env.MOBIZON_API_KEY,
  webhook: !!process.env.WEBHOOK_SECRET,
  cron: !!process.env.CRON_SECRET,
});

export async function sendTelegram(text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log("[telegram:off]", text);
    return false;
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
    });
    return r.ok;
  } catch (e) {
    console.error("[telegram]", e);
    return false;
  }
}

/** SMS (Mobizon) — WhatsApp қосылмаған жағдайда клиентке еске салу үшін. */
export async function sendSms(phone: string, text: string): Promise<boolean> {
  const key = process.env.MOBIZON_API_KEY;
  if (!key) {
    console.log("[sms:off]", phone, text);
    return false;
  }
  try {
    const url = new URL("https://api.mobizon.kz/service/message/sendsmsmessage");
    url.searchParams.set("apiKey", key);
    url.searchParams.set("recipient", phone.replace(/\D/g, ""));
    url.searchParams.set("text", text);
    const r = await fetch(url, { method: "POST" });
    return r.ok;
  } catch (e) {
    console.error("[sms]", e);
    return false;
  }
}
