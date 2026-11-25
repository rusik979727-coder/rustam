/** Телефонды +7XXXXXXXXXX түріне келтіреді. Танылмаса — бос жолсыз бастапқы мәнді қайтарады. */
export function normalizePhone(raw: string): string {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) return "+7" + digits.slice(1);
  if (digits.length === 10) return "+7" + digits;
  if (digits.length > 0) return "+" + digits;
  return (raw || "").trim();
}
