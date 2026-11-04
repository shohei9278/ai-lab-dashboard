"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

async function call(body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch("/api/sns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : {};
  return res?.ok ? null : (data.error ?? "うまくいきませんでした");
}

// これから自動で投稿される下書き: 直す・消す
export function DraftControls({ id, text }: { id: number; text: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>) => {
    const e = await call(body);
    setError(e);
    if (!e) { setEditing(false); router.refresh(); }
  };
  if (editing) {
    return (
      <div className="space-y-1">
        <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={4} maxLength={1000} className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
        <div className="flex gap-2 text-xs">
          <button type="button" className="rounded border border-line px-2 py-0.5" onClick={() => run({ action: "update", id, text: value })}>保存</button>
          <button type="button" className="text-ink-2 underline" onClick={() => { setEditing(false); setValue(text); }}>やめる</button>
        </div>
        {error && <p className="text-xs" style={{ color: "var(--critical)" }}>{error}</p>}
      </div>
    );
  }
  return (
    <div className="flex gap-3 text-xs">
      <button type="button" className="text-accent underline" onClick={() => setEditing(true)}>文を直す</button>
      <button type="button" className="text-ink-2 underline" onClick={() => confirm("この下書きを消しますか？（次の投稿では、AIが新しく書き直します）") && run({ action: "delete", id })}>消す</button>
      {error && <span style={{ color: "var(--critical)" }}>{error}</span>}
    </div>
  );
}

// 投稿済み: SNS側で消したときに、記録からも外す
export function ForgetPost({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs text-ink-2 underline"
      onClick={async () => {
        if (!confirm("SNSで投稿を消したときに、記録からも外します。外しますか？（SNSの投稿そのものは消えません）")) return;
        if (!(await call({ action: "delete", id }))) router.refresh();
      }}
    >
      記録から外す
    </button>
  );
}

// 案件ごとに、自動投稿を止める・再開する
export function PauseToggle({ projectId, paused }: { projectId: number; paused: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <label className="flex items-center gap-1 text-xs text-ink-2">
      <input
        type="checkbox"
        checked={!paused}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true);
          await call({ action: "pause", projectId, paused: !e.target.checked });
          setBusy(false);
          router.refresh();
        }}
      />
      自動で投稿する
    </label>
  );
}

// コメントへの返信: AIの案を直して送る・返さない
export function ReplyControls({ id, draft, reason, platform }: { id: number; draft: string | null; reason: string | null; platform: string }) {
  const router = useRouter();
  const [value, setValue] = useState(draft ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    const e = await call(body);
    setBusy(false);
    setError(e);
    if (!e) router.refresh();
  };
  return (
    <div className="space-y-1">
      {reason && !draft && <p className="text-xs text-ink-2">AIの判断: {reason}</p>}
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={3}
        maxLength={platform === "bluesky" ? 300 : 500}
        placeholder={draft ? "" : "返信するなら、ここに書いてください"}
        className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" disabled={busy || !value.trim()} className="rounded-lg bg-accent px-3 py-1 font-medium text-accent-ink disabled:opacity-50" onClick={() => run({ action: "reply", id, text: value })}>
          {busy ? "送っています…" : "この文で返信する"}
        </button>
        <button type="button" disabled={busy} className="text-ink-2 underline" onClick={() => run({ action: "ignore", id })}>返さない</button>
        {error && <span style={{ color: "var(--critical)" }}>{error}</span>}
      </div>
    </div>
  );
}

// コメントを今すぐ取り込む
export function SyncComments() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-lg border border-line px-3 py-1 text-xs"
      onClick={async () => { setBusy(true); await call({ action: "sync-comments" }); setBusy(false); router.refresh(); }}
    >
      {busy ? "取り込んでいます…" : "今すぐ取り込む"}
    </button>
  );
}
