import "server-only";
import { cookies } from "next/headers";
import { translator, type Locale } from "./i18n";

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get("lang")?.value;
  return v === "ru" ? "ru" : "kk";
}
export async function getT() {
  const locale = await getLocale();
  return { t: translator(locale), locale };
}
