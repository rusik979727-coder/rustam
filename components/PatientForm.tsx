import { Field, Select } from "./ui";
import type { T } from "@/lib/i18n";
import { COMPLAINTS } from "@/lib/constants";
import { savePatient } from "@/app/(crm)/actions";
import { ymd } from "@/lib/format";

type P = { id: number; fullName: string; phone: string; iin: string | null; birthDate: Date | null; gender: string | null; diagnosis: string | null; hasMri: boolean; notes: string | null };

export function PatientForm({ t, p }: { t: T; p?: P }) {
  return (
    <form action={savePatient} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label={t("common.name")}><input name="fullName" defaultValue={p?.fullName} className="input" required /></Field>
      <Field label={t("common.phone")}><input name="phone" defaultValue={p?.phone} className="input" required /></Field>
      <Field label={t("patients.iin")}><input name="iin" defaultValue={p?.iin ?? ""} className="input" maxLength={12} pattern="\d{12}" /></Field>
      <Field label={t("patients.birth")}><input type="date" name="birthDate" defaultValue={p?.birthDate ? ymd(p.birthDate) : ""} className="input" /></Field>
      <Field label={t("patients.gender")}><Select name="gender" defaultValue={p?.gender} options={[{ value: "", label: "—" }, { value: "M", label: t("gender.M") }, { value: "F", label: t("gender.F") }]} /></Field>
      <Field label={t("patients.diagnosis")}><Select name="diagnosis" defaultValue={p?.diagnosis} options={[{ value: "", label: "—" }, ...COMPLAINTS.map((c) => ({ value: c, label: t(`complaint.${c}`) }))]} /></Field>
      <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" name="hasMri" defaultChecked={p?.hasMri} /> {t("patients.mri")}</label>
      <Field label={t("common.comment")}><input name="notes" defaultValue={p?.notes ?? ""} className="input" /></Field>
      <div className="md:col-span-2 lg:col-span-4"><button className="btn">{t("common.save")}</button></div>
    </form>
  );
}
