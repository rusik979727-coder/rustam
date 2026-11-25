import { describe, it, expect } from "vitest";
import { funnel, avgResponseMinutes, groupCount } from "@/lib/stats";
import { pickManager } from "@/lib/assign";
import { normalizePhone } from "@/lib/phone";
import { guessComplaint } from "@/lib/leads";

const at = (h: number, m = 0) => new Date(2026, 10, 25, h, m);

describe("stats", () => {
  const base = { managerId: 1, source: "INSTAGRAM", lostReason: null };
  const c = at(10);
  const leads = [
    { ...base, status: "NEW", createdAt: c, firstResponseAt: null },
    { ...base, status: "BOOKED", createdAt: c, firstResponseAt: at(10, 10) },
    { ...base, status: "PAID", createdAt: c, firstResponseAt: at(10, 20) },
    { ...base, status: "LOST", createdAt: c, firstResponseAt: at(10, 30), source: "2GIS" },
  ];
  it("SPAM (Басылып кетті) is excluded from funnel", () => {
    expect(funnel([...leads, { ...base, status: "SPAM", createdAt: c, firstResponseAt: null }]).total).toBe(4);
  });
  it("funnel and conversion", () => {
    expect(funnel(leads)).toMatchObject({ total: 4, booked: 2, arrived: 1, paid: 1, lost: 1, convBooked: 50, convPaid: 25 });
  });
  it("average response", () => expect(avgResponseMinutes(leads)).toBe(20));
  it("group by source", () => expect(groupCount(leads, (l) => l.source)).toEqual([["INSTAGRAM", 3], ["2GIS", 1]]));
});

describe("round-robin", () => {
  it("picks manager who waited longest, never-assigned first", () => {
    expect(pickManager([{ id: 1, lastAssignedAt: at(10) }, { id: 2, lastAssignedAt: null }, { id: 3, lastAssignedAt: at(9) }])?.id).toBe(2);
    expect(pickManager([{ id: 1, lastAssignedAt: at(10) }, { id: 3, lastAssignedAt: at(9) }])?.id).toBe(3);
    expect(pickManager([])).toBeNull();
  });
});

describe("phone & complaint", () => {
  it("normalizes KZ numbers", () => {
    expect(normalizePhone("8 (701) 123-45-67")).toBe("+77011234567");
    expect(normalizePhone("7011234567")).toBe("+77011234567");
    expect(normalizePhone("+7 701 123 45 67")).toBe("+77011234567");
  });
  it("guesses complaint from text", () => {
    expect(guessComplaint("Белімде грыжа бар")).toBe("HERNIA");
    expect(guessComplaint("протрузия L5")).toBe("PROTRUSION");
    expect(guessComplaint("тізе артрозы")).toBe("ARTHROSIS");
    expect(guessComplaint("hello")).toBe("OTHER");
  });
});
