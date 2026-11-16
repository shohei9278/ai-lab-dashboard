"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InterventionRow } from "@/lib/interventions";

const EMPTY = { title: "", happened: "", noticed: "", decision: "", result: "", commit: "", kind: "bug", day: "" };
const FOUND = [["human", "人"], ["gpt", "GPTのレビュー"], ["test", "自動テスト"], ["release", "公開後"]] as const;
const field = "mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-ink";

// 記録を足す・あとから直す（書いた内容は公開される）。edit を渡すと、その記録を直す
export function InterventionForm({ edit }: { edit?: InterventionRow }) {
  const router = useRouter();
  const start = edit
    ? { title: edit.title, happened: edit.happened, noticed: edit.noticed, decision: edit.decision, result: edit.result ?? "", commit: edit.commit_sha ?? "", kind: edit.kind, day: edit.day }
    : EMPTY;
  const [v, setV] = useState(start);
  const [found, setFound] = useState<string[]>(edit?.found_by ? edit.found_by.split(",") : []);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/interventions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...v, found_by: found, ...(edit ? { action: "edit", id: edit.id } : {}) }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!res.ok) return setError(data.error ?? "保存できませんでした");
    if (edit) setOpen(false);
    else {
      setV(EMPTY);
      setFound([]);
    }
    router.refresh();
  };
  return (
    <details className={edit ? "mt-2 rounded-lg border border-line p-3" : "card p-4"} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={edit ? "cursor-pointer text-xs text-accent" : "cursor-pointer text-sm font-medium"}>{edit ? "この記録を直す（直した内容は公開されます）" : "記録を足す（書いた内容は公開されます）"}</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-ink-2 sm:col-span-2">題（必須）<input value={v.title} onChange={set("title")} maxLength={80} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">問題（必須）<textarea value={v.happened} onChange={set("happened")} maxLength={400} rows={edit ? 4 : 2} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">人の対応（必須）<textarea value={v.noticed} onChange={set("noticed")} maxLength={300} rows={edit ? 4 : 2} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">AIの対応（必須）<textarea value={v.decision} onChange={set("decision")} maxLength={400} rows={edit ? 4 : 2} className={field} /></label>
        <label className="text-xs text-ink-2 sm:col-span-2">結果（任意）<textarea value={v.result} onChange={set("result")} maxLength={300} rows={edit ? 4 : 2} className={field} /></label>
        <fieldset className="text-xs text-ink-2 sm:col-span-2">
          <legend>問題を見つけたのは（複数可）</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {FOUND.map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="checkbox" checked={found.includes(k)} onChange={(e) => setFound((x) => (e.target.checked ? [...x, k] : x.filter((y) => y !== k)))} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-xs text-ink-2">種類
          <select value={v.kind} onChange={set("kind")} className={field}><option value="bug">不具合</option><option value="design">仕組みの変更</option><option value="direction">方針の判断</option></select>
        </label>
        <label className="text-xs text-ink-2">修正のコミット（任意）<input value={v.commit} onChange={set("commit")} maxLength={40} className={field} /></label>
        <label className="text-xs text-ink-2">{edit ? "日付" : "日付（空なら今日）"}<input type="date" value={v.day} onChange={set("day")} className={field} /></label>
      </div>
      <button type="button" disabled={busy} onClick={save} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink disabled:opacity-50">{busy ? "保存しています…" : edit ? "直す" : "記録する"}</button>
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

// AIの提案への答え（やった・見送りとひとこと）を、あとから直す
export function EditAnswer({ id, status, note }: { id: number; status: "done" | "declined"; note: string | null }) {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [n, setN] = useState(note ?? "");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answer: { id, status: s, note: n, edit: true } }) }).catch(() => null);
    if (!res?.ok) return setError("直せませんでした");
    setOpen(false);
    router.refresh();
  };
  return (
    <details className="mt-1" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-xs text-accent">答えを直す</summary>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-2">結果
          <select value={s} onChange={(e) => setS(e.target.value as typeof s)} className={field}><option value="done">やった</option><option value="declined">見送り</option></select>
        </label>
        <label className="min-w-0 flex-1 text-xs text-ink-2">ひとこと（公開されます）<input value={n} onChange={(e) => setN(e.target.value)} maxLength={300} className={field} /></label>
        <button type="button" onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">直す</button>
      </div>
      {error && <p className="mt-1 text-xs" style={{ color: "var(--critical)" }}>{error}</p>}
    </details>
  );
}
