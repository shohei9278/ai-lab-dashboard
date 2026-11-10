"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const EMPTY = { title: "", happened: "", noticed: "", decision: "", commit: "", kind: "bug" };
const field = "mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink";

// 記録を足す（書いた内容は公開される）
export function InterventionForm() {
  const router = useRouter();
  const [v, setV] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/interventions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(v) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "保存できませんでした");
    setV(EMPTY);
    router.refresh();
  };
  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">記録を足す（書いた内容は公開されます）</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-2 sm:col-span-2">題（必須）<input value={v.title} onChange={set("title")} maxLength={80} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">起きたこと（必須）<textarea value={v.happened} onChange={set("happened")} maxLength={400} rows={2} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">どう気づいたか（必須）<textarea value={v.noticed} onChange={set("noticed")} maxLength={300} rows={2} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">人の判断（必須）<textarea value={v.decision} onChange={set("decision")} maxLength={400} rows={2} className={field} /></label>
        <label className="text-xs text-ink-2">種類
          <select value={v.kind} onChange={set("kind")} className={field}><option value="bug">不具合</option><option value="design">仕組みの変更</option><option value="direction">方針の判断</option></select>
        </label>
        <label className="text-xs text-ink-2">修正のコミット（任意）<input value={v.commit} onChange={set("commit")} maxLength={40} className={field} /></label>
      </div>
      <button type="button" disabled={busy} onClick={save} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50">{busy ? "保存しています…" : "記録する"}</button>
      {error && <p className="mt-2 text-xs" style={{ color: "var(--critical)" }}>{error}</p>}
    </details>
  );
}

// 間違えて入れた記録を消す
export function HideIntervention({ id }: { id: number }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button" className="text-xs underline" style={{ color: failed ? "var(--critical)" : "var(--muted)" }}
      onClick={async () => {
        if (!confirm("この記録を消しますか？")) return;
        setFailed(false);
        const res = await fetch("/api/interventions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "hide", id }) }).catch(() => null);
        if (!res?.ok) return setFailed(true);
        router.refresh();
      }}
    >
      {failed ? "消せませんでした（もう一度）" : "消す"}
    </button>
  );
}
