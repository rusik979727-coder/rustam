import { db } from "./db";
import { patientBalance } from "./finance";

export async function debtors(limit = 50) {
  const ps = await db.patient.findMany({
    include: {
      courses: { select: { price: true, status: true } },
      appointments: { select: { price: true, status: true, courseId: true } },
      payments: { select: { amount: true } },
    },
  });
  return ps
    .map((p) => ({ id: p.id, fullName: p.fullName, phone: p.phone, ...patientBalance(p) }))
    .filter((p) => p.debt > 0)
    .sort((a, b) => b.debt - a.debt)
    .slice(0, limit);
}
