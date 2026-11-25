import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "beles_session";
const key = () => new TextEncoder().encode(process.env.AUTH_SECRET || "dev-secret-change-me");

export async function signSession(userId: number, role: string) {
  return new SignJWT({ uid: userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(key());
}

export async function verifySession(token: string | undefined) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return { uid: Number(payload.uid), role: String(payload.role) };
  } catch {
    return null;
  }
}
