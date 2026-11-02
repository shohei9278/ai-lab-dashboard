"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreatePlan() {
  const router = useRouter();
  const [followers, setFollowers] = useState("");
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="card space-y-3 p-4">
      <h2 className="font-bold">作戦を作る</h2>
      <div className="flex flex-wrap items-end gap-3 text-xs text-ink-2">
        <label>今のフォロワー数（任意）
          <input type="number" min={0} value={followers} onChange={(e) => setFollowers(e.target.value)} className="num mt-1 block w-28 rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
        </label>
        <label className="min-w-64 flex-1">希望（任意）
          <input value={wish} onChange={(e) => setWish(e.target.value)} maxLength={500} placeholder="例: 週に2時間まで、顔出しはしない" className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
        </label>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            const res = await fetch("/api/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create", followers, wish }) }).catch(() => null);
            const data = res ? await res.json().catch(() => ({})) : {};
            setBusy(false);
            if (!res?.ok) return setError(data.error ?? "作れませんでした");
            router.refresh();
          }}
          className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
        >
          {busy ? "AIが考えています（30秒〜1分）…" : "AIに作戦を考えさせる（約10〜20円）"}
        </button>
      </div>
      {error && <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">{error}</p>}
    </section>
  );
}

export function TaskCheck({ id, index, done, children }: { id: number; index: number; done: boolean; children: React.ReactNode }) {
  const router = useRouter();
  const [on, setOn] = useState(done);
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        className="mt-1"
        checked={on}
        onChange={async (e) => {
          setOn(e.target.checked);
          await fetch("/api/growth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "toggle", id, index, done: e.target.checked }) }).catch(() => null);
          router.refresh();
        }}
      />
      <span className={on ? "text-muted line-through" : ""}>{children}</span>
    </label>
  );
}
