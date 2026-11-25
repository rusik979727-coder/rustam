"use server";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { LOGIN_WINDOW_MIN, LOGIN_MAX_FAILS } from "@/lib/security";

// Пайдаланушы бар-жоғын уақыт бойынша білдірмеу үшін жалған хэш
let dummyHash: string | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hashSync("not-a-real-password", 10));

export async function loginAction(_: unknown, fd: FormData) {
  const login = String(fd.get("login") || "").trim().slice(0, 100);
  const password = String(fd.get("password") || "").slice(0, 200);
  const h = await headers();
  // Caddy X-Real-IP-ді клиенттің нақты адресінен қояды (жалғандауға болмайды)
  const ip = (h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "local").trim();
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60000);
  // Логин бойынша да, IP бойынша да шектеу
  const [byLogin, byIp] = await Promise.all([
    db.loginAttempt.count({ where: { key: `l:${login}`, success: false, createdAt: { gte: since } } }),
    db.loginAttempt.count({ where: { key: `ip:${ip}`, success: false, createdAt: { gte: since } } }),
  ]);
  if (byLogin >= LOGIN_MAX_FAILS || byIp >= LOGIN_MAX_FAILS * 4) return { error: "locked" as const };

  const user = await db.user.findUnique({ where: { login } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? getDummyHash());
  if (!user || !user.active || !ok) {
    await db.loginAttempt.createMany({ data: [{ key: `l:${login}`, success: false }, { key: `ip:${ip}`, success: false }] });
    await audit(user?.id ?? null, "User", user?.id ?? null, "login_failed", { login, ip });
    return { error: "invalid" as const };
  }
  await db.loginAttempt.deleteMany({ where: { key: `l:${login}` } });
  await createSession(user.id, user.role, user.sessionVersion);
  await audit(user.id, "User", user.id, "login");
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function setLang(fd: FormData) {
  const lang = fd.get("lang") === "ru" ? "ru" : "kk";
  (await cookies()).set("lang", lang, { path: "/", maxAge: 60 * 60 * 24 * 365 });
  let back = String(fd.get("back") || "");
  if (!back) {
    const ref = (await headers()).get("referer");
    try { back = ref ? new URL(ref).pathname + new URL(ref).search : "/"; } catch { back = "/"; }
  }
  redirect(back.startsWith("/") ? back : "/");
}
