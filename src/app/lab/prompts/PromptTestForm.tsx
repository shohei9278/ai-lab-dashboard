"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// プロンプトの比較を始める: 案件と、変える所を選ぶ。費用は項目ごとの見積もりを出してから実行する
export function PromptTestForm({ projects, factors }: {
  projects: { id: number; title: string }[];
  factors: { key: string; label: string; a: string; b: string; why: string; estimate: number }[];
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? 0);
  const [factor, setFactor] = useState(factors[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const f = factors.find((x) => x.key === factor);
  if (!projects.length) return <p className="text-sm text-ink-2">比べられる案件（文言の材料がある事前登録LP）がまだありません。</p>;
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!f || !window.confirm(`「${f.label}」を比べます。費用は約${f.estimate}円です。実行しますか？`)) return;
        setBusy(true);
        setMsg(null);
        const res = await fetch("/api/prompt-tests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, factor }) });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setBusy(false);
        if (!res.ok) return setMsg(data.error ?? "始められませんでした");
        router.refresh();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted">材料にする案件</span>
          <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))} className="block w-full rounded-lg border border-line bg-surface px-2 py-1.5">
            {projects.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-xs text-muted">変える所</span>
          <select value={factor} onChange={(e) => setFactor(e.target.value)} className="block w-full rounded-lg border border-line bg-surface px-2 py-1.5">
            {factors.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
      </div>
      {f && (
        <p className="text-sm text-ink-2">
          今の渡し方「{f.a}」と、変えた渡し方「{f.b}」で1つずつLPを作ります。{f.why}。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy || !f} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50">
          {busy ? "始めています…" : `比べる（約${f?.estimate ?? "—"}円）`}
        </button>
        <span className="text-xs text-muted">作ったLPは案件には使いません。終わるまで5〜10分ほどかかります。</span>
      </div>
      {msg && <p className="text-xs" style={{ color: "var(--critical)" }}>{msg}</p>}
    </form>
  );
}
