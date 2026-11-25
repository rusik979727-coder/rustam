"use server";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { createSession, destroySession } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function loginAction(_: unknown, fd: FormData) {
  const login = String(fd.get("login") || "").trim();
  const password = String(fd.get("password") || "");
  const user = await db.user.findUnique({ where: { login } });
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) return { error: true };
  await createSession(user.id, user.role);
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
