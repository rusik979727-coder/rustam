import { db } from "./db";
import type { CurrentUser } from "./auth";

/** Дәрігер тек өзіне жазылған/өз курсындағы пациенттерді көреді; менеджерлер — барлығын. */
export async function canAccessPatient(user: CurrentUser, patientId: number) {
  if (user.role !== "DOCTOR") return true;
  const doctorId = user.doctor?.id;
  if (!doctorId) return false;
  const [a, c] = await Promise.all([
    db.appointment.count({ where: { patientId, doctorId } }),
    db.treatmentCourse.count({ where: { patientId, doctorId } }),
  ]);
  return a + c > 0;
}

export async function assertPatientAccess(user: CurrentUser, patientId: number) {
  if (!(await canAccessPatient(user, patientId))) throw new Error("Forbidden");
}
