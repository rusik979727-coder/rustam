import { describe, it, expect } from "vitest";
import { decideReminder, isWindowOpen } from "@/lib/whatsapp";

const now = new Date(2026, 10, 25, 12, 0);
const h = (n: number) => new Date(now.getTime() + n * 3600_000);
const base = { now, status: "BOOKED", lastInboundAt: null as Date | null, mainSent: false, sameDaySent: false, hoursBefore: 24 };

describe("24h window", () => {
  it("open within 23h of last inbound, closed after", () => {
    expect(isWindowOpen(h(-1), now)).toBe(true);
    expect(isWindowOpen(h(-22.9), now)).toBe(true);
    expect(isWindowOpen(h(-23.5), now)).toBe(false);
    expect(isWindowOpen(null, now)).toBe(false);
  });
});

describe("reminder cost decisions", () => {
  it("free when patient wrote recently", () => {
    expect(decideReminder({ ...base, startAt: h(20), lastInboundAt: h(-3) }).main).toBe("free");
  });
  it("skips paid reminder when patient already confirmed", () => {
    expect(decideReminder({ ...base, startAt: h(20), status: "CONFIRMED" }).main).toBe("skip");
  });
  it("paid only when unconfirmed and window closed", () => {
    expect(decideReminder({ ...base, startAt: h(20) }).main).toBe("paid");
  });
  it("nothing before the reminder time, nothing twice", () => {
    expect(decideReminder({ ...base, startAt: h(30) }).main).toBeNull();
    expect(decideReminder({ ...base, startAt: h(20), mainSent: true }).main).toBeNull();
  });
  it("same-day reminder is free-only, never paid", () => {
    expect(decideReminder({ ...base, startAt: h(1.5), mainSent: true, lastInboundAt: h(-2) }).sameDay).toBe("free");
    expect(decideReminder({ ...base, startAt: h(1.5), mainSent: true }).sameDay).toBe("skip");
  });
  it("no reminders for cancelled / past appointments", () => {
    expect(decideReminder({ ...base, startAt: h(5), status: "CANCELLED" })).toEqual({ main: null, sameDay: null });
    expect(decideReminder({ ...base, startAt: h(-1) })).toEqual({ main: null, sameDay: null });
  });
  it("respects REMINDER_HOURS", () => {
    expect(decideReminder({ ...base, startAt: h(5), hoursBefore: 3 }).main).toBeNull();
    expect(decideReminder({ ...base, startAt: h(2.5), hoursBefore: 3 }).main).toBe("paid");
  });
});
