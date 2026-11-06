"use client";

import { useState } from "react";

export function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="card max-w-sm space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
        setBusy(false);
        if (res.ok) window.location.href = "/";
        else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "ログインできませんでした");
      }}
    >
      <label className="block text-sm">
        パスワード
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-1.5" />
      </label>
      <button type="submit" data-demo-ok disabled={busy || !password} className="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50">
        {busy ? "確かめています…" : "ログイン"}
      </button>
      {error && <p className="text-sm" style={{ color: "var(--critical)" }}>{error}</p>}
    </form>
  );
}

export function LogoutButton() {
  return (
    <button
      type="button"
      data-demo-ok
      className="text-xs text-muted underline"
      onClick={async () => {
        await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ logout: true }) });
        window.location.href = "/";
      }}
    >
      ログアウト
    </button>
  );
}
