import { createHmac, timingSafeEqual } from "crypto";

/** Уақыт бойынша ақпарат бермейтін салыстыру */
export function safeEqual(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Meta (WhatsApp/Instagram) webhook қолтаңбасы: X-Hub-Signature-256 = sha256=HMAC(appSecret, rawBody) */
export function verifyMetaSignature(rawBody: string, header: string | null, appSecret: string | undefined) {
  if (!appSecret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(header, expected);
}

/** Excel формула шабуылынан қорғау (CSV injection) */
export function csvSafe(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/^\+\d{6,15}$/.test(s)) return s; // таза телефон нөмірі — формула емес
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

export const PASSWORD_MIN = 8;
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `min ${PASSWORD_MIN}`;
  if (/^(.)\1+$/.test(pw) || /^(12345678|password|qwerty)/i.test(pw)) return "weak";
  return null;
}

/** Логин: 15 минутта 5 сәтсіз әрекет → бұғаттау */
export const LOGIN_WINDOW_MIN = 15;
export const LOGIN_MAX_FAILS = 5;
