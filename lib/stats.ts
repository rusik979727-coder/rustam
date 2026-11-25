import { pct } from "./format";

export type LeadLite = {
  status: string;
  managerId: number | null;
  source: string;
  createdAt: Date;
  firstResponseAt: Date | null;
  lostReason: string | null;
};

const REACHED_BOOKED = new Set(["BOOKED", "ARRIVED", "PAID"]);

/** Воронка: лид → жазылды → келді → төледі */
export function funnel(leads: LeadLite[]) {
  const total = leads.length;
  const booked = leads.filter((l) => REACHED_BOOKED.has(l.status)).length;
  const arrived = leads.filter((l) => l.status === "ARRIVED" || l.status === "PAID").length;
  const paid = leads.filter((l) => l.status === "PAID").length;
  const lost = leads.filter((l) => l.status === "LOST").length;
  return { total, booked, arrived, paid, lost, convBooked: pct(booked, total), convPaid: pct(paid, total) };
}

/** Орташа алғашқы жауап уақыты (минут) */
export function avgResponseMinutes(leads: LeadLite[]) {
  const xs = leads
    .filter((l) => l.firstResponseAt)
    .map((l) => (l.firstResponseAt!.getTime() - l.createdAt.getTime()) / 60000);
  if (!xs.length) return null;
  return Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

export function groupCount<T>(xs: T[], key: (x: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const x of xs) {
    const k = key(x);
    if (!k) continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
