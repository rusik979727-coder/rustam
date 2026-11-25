import { getT } from "@/lib/i18n-server";
import { LoginForm } from "@/components/LoginForm";
import { LangSwitch } from "@/components/LangSwitch";

export default async function LoginPage() {
  const { t, locale } = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-brand-700">{t("app.title")}</div>
            <div className="text-sm text-slate-500">{t("login.title")}</div>
          </div>
          <LangSwitch locale={locale} back="/login" />
        </div>
        <LoginForm labels={{ login: t("login.login"), password: t("login.password"), submit: t("login.submit"), error: t("login.error"), locked: t("login.locked") }} />
      </div>
    </main>
  );
}
