import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, signSession, verifySession } from "./session";
import type { Role } from "./constants";

export async function createSession(userId: number, role: string, ver: number) {
  const token = await signSession(userId, role, ver);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentUser() {
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const user = await db.user.findUnique({ where: { id: s.uid }, include: { doctor: true } });
  // Құпиясөз ауысса не қызметкер өшірілсе — ескі сессия жарамсыз
  if (!user || !user.active || user.sessionVersion !== s.ver) return null;
  return user;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

export async function requireUser(roles?: Role[]) {
  const u = await currentUser();
  if (!u) redirect("/login");
  if (roles && !roles.includes(u.role as Role)) redirect("/");
  return u;
}

export const isHead = (u: { role: string }) => u.role === "HEAD_MANAGER";
