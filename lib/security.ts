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

/** Жүктеуге рұқсат етілген файлдар: кеңейтім → MIME. HTML/SVG/JS — тыйым. */
export const ALLOWED_UPLOADS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  dcm: "application/dicom",
};
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Браузерде ашуға болатындар (қалғаны тек жүктеп алынады) */
export const INLINE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
  "application/pdf": (b) => b.subarray(0, 5).toString() === "%PDF-",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b[0] === 0x50 && b[1] === 0x4b,
  "application/msword": (b) => b.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])),
};

/** Файлды тексереді: кеңейтім, өлшем, ішкі «магиялық» байттар. null — рұқсат жоқ. */
export function checkUpload(fileName: string, data: Buffer): { mime: string } | null {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const mime = ALLOWED_UPLOADS[ext];
  if (!mime || data.length === 0 || data.length > MAX_UPLOAD_BYTES) return null;
  const magic = MAGIC[mime];
  if (magic && !magic(data)) return null;
  return { mime };
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
