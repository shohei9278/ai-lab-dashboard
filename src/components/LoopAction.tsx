"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// /api/loop を呼んで画面を更新する。AIを呼ぶ操作は数秒〜数十秒かかるので、待ち表示を出す
export function useLoopAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, body: Record<string, unknown>) {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch("/api/loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "エラーが発生しました");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("通信に失敗しました");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { run, busy, error };
}

export function BusyNote({ busy, error }: { busy: string | null; error: string | null }) {
  if (busy) {
    return (
      <p className="text-sm text-ink-2" role="status">
        <span aria-hidden className="mr-1 inline-block animate-spin">◐</span>
        {busy}
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">
        <span aria-hidden>! </span>{error}
      </p>
    );
  }
  return null;
}

export function ActionButton({
  children, onClick, disabled, variant = "secondary",
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean; variant?: "primary" | "secondary" | "danger" }) {
  const cls =
    variant === "primary"
      ? "bg-accent text-accent-ink border-accent"
      : variant === "danger"
        ? "border-line text-ink"
        : "border-line text-ink hover:bg-surface-2";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${cls}`}
      style={variant === "danger" ? { color: "var(--critical)" } : undefined}
    >
      {children}
    </button>
  );
}
