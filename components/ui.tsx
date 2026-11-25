import type { ReactNode } from "react";

export function Stat({ label, value, tone = "default", hint }: { label: string; value: ReactNode; tone?: "default" | "alert" | "good"; hint?: ReactNode }) {
  const toneCls = tone === "alert" ? "border-red-200 bg-red-50" : tone === "good" ? "border-brand-100 bg-brand-50" : "";
  return (
    <div className={`card ${toneCls}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "alert" ? "text-red-700" : "text-slate-900"}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

/** Жоспар орындалу сызығы: бір түс, мәтінмен қоса (тек түске сүйенбейді). */
export function Meter({ label, fact, plan, format = (n: number) => String(n) }: { label: string; fact: number; plan: number; format?: (n: number) => string }) {
  const p = plan > 0 ? Math.round((fact / plan) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-slate-600">
          {format(fact)} / {format(plan)} · <b>{p}%</b>
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-2 rounded-full bg-brand-600" style={{ width: `${Math.min(100, p)}%` }} />
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = {
  NEW: "bg-sky-100 text-sky-800",
  CONTACTED: "bg-indigo-100 text-indigo-800",
  BOOKED: "bg-amber-100 text-amber-800",
  ARRIVED: "bg-teal-100 text-teal-800",
  PAID: "bg-emerald-100 text-emerald-800",
  LOST: "bg-slate-200 text-slate-600",
  CONFIRMED: "bg-indigo-100 text-indigo-800",
  NO_SHOW: "bg-red-100 text-red-700",
  CANCELLED: "bg-slate-200 text-slate-600",
  ACTIVE: "bg-teal-100 text-teal-800",
  DONE: "bg-emerald-100 text-emerald-800",
};
export function StatusBadge({ status, label }: { status: string; label: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? "bg-slate-100 text-slate-700"}`}>{label}</span>;
}

export function Select({ name, options, defaultValue, className = "input", required, label }: {
  name: string;
  options: { value: string | number; label: string }[];
  defaultValue?: string | number | null;
  className?: string;
  required?: boolean;
  label?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className={className} required={required} aria-label={label}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="py-4 text-center text-sm text-slate-400">{text}</p>;
}
