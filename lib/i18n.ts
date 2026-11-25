import kk from "@/messages/kk.json";
import ru from "@/messages/ru.json";

export const LOCALES = ["kk", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
const dicts: Record<Locale, Record<string, string>> = { kk, ru };

export function translator(locale: Locale) {
  const d = dicts[locale] ?? kk;
  return (key: string, vars?: Record<string, string | number>) => {
    let s = d[key] ?? (kk as Record<string, string>)[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
    return s;
  };
}
export type T = ReturnType<typeof translator>;
