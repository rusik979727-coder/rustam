"use client";
import { useActionState } from "react";
import { loginAction } from "@/app/actions-public";

export function LoginForm({ labels }: { labels: Record<string, string> }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-3">
      <div>
        <label className="label" htmlFor="login">{labels.login}</label>
        <input id="login" name="login" className="input" autoComplete="username" required />
      </div>
      <div>
        <label className="label" htmlFor="password">{labels.password}</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {state?.error && <p className="text-sm text-red-600">{labels.error}</p>}
      <button className="btn w-full" disabled={pending}>{labels.submit}</button>
    </form>
  );
}
