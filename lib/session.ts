import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "beles_session";
const DEV_SECRET = "dev-only-secret-not-for-production-use-0000";

/** AUTH_SECRET міндетті: продакшнда жоқ/қысқа болса — жүйе іске қосылмайды. */
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32 && !s.startsWith("change-me")) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET кемінде 32 таңбалы кездейсоқ жол болуы керек (openssl rand -base64 48)");
  }
  return DEV_SECRET;
}
const key = () => new TextEncoder().encode(authSecret());

export async function signSession(userId: number, role: string, ver: number) {
  return new SignJWT({ uid: userId, role, ver })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key());
}

export async function verifySession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ["HS256"] });
    return { uid: Number(payload.uid), role: String(payload.role), ver: Number(payload.ver ?? 0) };
  } catch {
    return null;
  }
}
