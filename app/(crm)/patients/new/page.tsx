import { requireUser } from "@/lib/auth";
import { getT } from "@/lib/i18n-server";
import { PatientForm } from "@/components/PatientForm";

export default async function NewPatient() {
  await requireUser();
  const { t } = await getT();
  return (
    <div className="space-y-4">
      <h1 className="h1">{t("patients.new")}</h1>
      <div className="card"><PatientForm t={t} /></div>
    </div>
  );
}
