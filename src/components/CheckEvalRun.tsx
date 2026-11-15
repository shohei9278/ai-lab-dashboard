"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// 公開前チェックの評価を始めるボタン（運営者だけ）。費用の見込みを確かめてから流す。流れている間は画面を数秒ごとに新しくする
export function CheckEvalRun({ models, running }: { models: { id: string; label: string; estimate: number }[]; running: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [running, router]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {models.map((m) => (
          <button
            key={m.id}
            type="button"
            disabled={running || !!busy}
            onClick={async () => {
              if (!window.confirm(`${m.label} で、40件の例をチェックさせます。費用は約${m.estimate}円です。実行しますか？`)) return;
              setBusy(m.id);
              setMsg(null);
              const res = await fetch("/api/check-eval", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: m.id }) });
              const data = (await res.json().catch(() => ({}))) as { error?: string };
              setBusy(null);
              if (!res.ok) return setMsg(data.error ?? "始められませんでした");
              router.refresh();
            }}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-50"
          >
            {busy === m.id ? "始めています…" : `${m.label} で評価する（約${m.estimate}円）`}
          </button>
        ))}
      </div>
      {msg && <p className="text-xs" style={{ color: "var(--critical)" }}>{msg}</p>}
    </div>
  );
}
