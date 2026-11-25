import { setLang } from "@/app/actions-public";

export function LangSwitch({ locale, back = "" }: { locale: string; back?: string }) {
  return (
    <form action={setLang} className="flex gap-1 text-xs">
      {back && <input type="hidden" name="back" value={back} />}
      {(["kk", "ru"] as const).map((l) => (
        <button key={l} name="lang" value={l} className={`rounded px-2 py-1 ${locale === l ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
          {l === "kk" ? "ҚАЗ" : "РУС"}
        </button>
      ))}
    </form>
  );
}
