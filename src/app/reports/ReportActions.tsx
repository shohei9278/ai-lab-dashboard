"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateReportButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const res = await fetch("/api/reports", { method: "POST" }).catch(() => null);
          const data = res ? await res.json().catch(() => ({})) : {};
          setBusy(false);
          if (!res?.ok) return setError(data.error ?? "作れませんでした");
          router.refresh();
        }}
        className="rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-50"
      >
        {busy ? "3社が会議をしています（2〜4分）…" : "今すぐ定例会議を開く（約40〜80円）"}
      </button>
      {error && <p className="text-sm" style={{ color: "var(--critical)" }} role="alert">{error}</p>}
    </div>
  );
}

export function CopyButton({ text, label = "コピー" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }).catch(() => {})}
      className="rounded border border-line px-2 py-0.5 text-xs"
    >
      {done ? "コピーしました" : label}
    </button>
  );
}

// レポートの気づきを、実験メモに追加する
export function AddNoteButton({ title, body, topic }: { title: string; body: string; topic: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  return (
    <button
      type="button"
      disabled={state !== "idle"}
      onClick={async () => {
        setState("busy");
        const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", author: "ai", title, body, topic, certainty: "once" }) }).catch(() => null);
        setState(res?.ok ? "done" : "idle");
      }}
      className="rounded border border-line px-2 py-0.5 text-xs text-accent disabled:text-muted"
    >
      {state === "done" ? "追加しました" : state === "busy" ? "追加しています…" : "実験メモに追加"}
    </button>
  );
}
