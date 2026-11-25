export type Charges = {
  courses: { price: number; status: string }[];
  appointments: { price: number; status: string; courseId: number | null }[];
  payments: { amount: number }[];
};

/** Пациенттің қарызы: курстар + курсқа кірмейтін өткен қабылдаулар − төлемдер. */
export function patientBalance(c: Charges) {
  const courseSum = c.courses.filter((x) => x.status !== "CANCELLED").reduce((s, x) => s + x.price, 0);
  const apptSum = c.appointments
    .filter((a) => a.courseId == null && a.status === "ARRIVED")
    .reduce((s, a) => s + a.price, 0);
  const paid = c.payments.reduce((s, p) => s + p.amount, 0);
  const charged = courseSum + apptSum;
  return { charged, paid, debt: Math.max(0, charged - paid), prepaid: Math.max(0, paid - charged) };
}
