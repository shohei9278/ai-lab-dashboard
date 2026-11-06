"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const post = (body: unknown) => fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function CancelTask({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs underline"
      onClick={async () => {
        if (!confirm("この予定を取りやめますか？")) return;
        await post({ cancelTaskId: id });
        router.refresh();
      }}
    >
      取りやめる
    </button>
  );
}

// 今日の計画を作る・作り直す（まだ実行していない予定は取りやめになる）
export function Replan({ label }: { label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await post({ action: "replan" });
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          setBusy(false);
          if (!res.ok) setError(data.error ?? "作れませんでした");
          router.refresh();
        }}
      >
        {busy ? "AIが考えています（1〜2分）…" : label}
      </button>
      {error && <span className="text-xs" style={{ color: "var(--critical)" }}>{error}</span>}
    </span>
  );
}
