"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Option = { id: string; label: string };
export type NoteDraft = { id?: number; topic: string; certainty: string; title: string; body: string; projectId: number | null };

// メモを書く・直すフォーム。id があれば編集、なければ追加
export function NoteEditor({ initial, topics, certainties, projects, onDone }: {
  initial: NoteDraft; topics: Option[]; certainties: Option[]; projects: { id: number; title: string }[]; onDone?: () => void;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NoteDraft>(k: K, val: NoteDraft[K]) => setV((s) => ({ ...s, [k]: val }));

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: v.id ? "update" : "add", ...v }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res?.ok) return setError(data.error ?? "保存できませんでした");
    if (!v.id) setV({ ...initial, title: "", body: "" });
    onDone?.();
    router.refresh();
  }

  const field = "block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm";
  return (
    <div className="space-y-3">
      <input value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="気づいたこと（例: GPTは自分の案を甘く採点する）" maxLength={120} className={field} aria-label="タイトル" />
      <textarea value={v.body} onChange={(e) => set("body", e.target.value)} placeholder="根拠の数字や、次に確かめたいこと" rows={3} maxLength={4000} className={field} aria-label="詳しく" />
      <div className="flex flex-wrap items-end gap-3 text-xs text-ink-2">
        <label>分類<select value={v.topic} onChange={(e) => set("topic", e.target.value)} className={`${field} mt-1 w-auto`}>{topics.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label>確からしさ<select value={v.certainty} onChange={(e) => set("certainty", e.target.value)} className={`${field} mt-1 w-auto`}>{certainties.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
        <label>関係する案件（任意）
          <select value={v.projectId ?? ""} onChange={(e) => set("projectId", e.target.value ? Number(e.target.value) : null)} className={`${field} mt-1 w-auto max-w-56`}>
            <option value="">なし</option>
            {projects.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.title}</option>)}
          </select>
        </label>
        <button type="button" onClick={save} disabled={busy || !v.title.trim()} className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50">
          {busy ? "保存しています…" : v.id ? "保存" : "メモを追加"}
        </button>
        {onDone && <button type="button" onClick={onDone} className="rounded-lg border border-line px-3 py-2 text-sm">やめる</button>}
      </div>
      {error && <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">{error}</p>}
    </div>
  );
}

// 一覧の1件ぶんの「直す」「消す」
export function NoteActions({ draft, topics, certainties, projects }: { draft: NoteDraft; topics: Option[]; certainties: Option[]; projects: { id: number; title: string }[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <div className="mt-3 border-t border-line pt-3"><NoteEditor initial={draft} topics={topics} certainties={certainties} projects={projects} onDone={() => setEditing(false)} /></div>;
  }
  return (
    <div className="mt-2 flex gap-3 text-xs">
      <button type="button" onClick={() => setEditing(true)} className="text-accent underline">直す</button>
      <button
        type="button"
        onClick={async () => {
          if (!window.confirm(`「${draft.title}」を消しますか？`)) return;
          await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: draft.id }) });
          router.refresh();
        }}
        className="text-ink-2 underline"
      >
        消す
      </button>
    </div>
  );
}
