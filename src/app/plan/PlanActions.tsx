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

// AIだけで出した投稿に、あとから印を付ける（ダメなら理由も。次の計画で同じ書き方を避けさせる）
export function ReviewPost({ table, id, current }: { table: "sns_posts" | "plan_tasks"; id: number; current: string | null }) {
  const router = useRouter();
  const send = async (verdict: "ok" | "bad") => {
    const note = verdict === "bad" ? window.prompt("どこがダメでしたか？（次の投稿でAIに避けさせます。空でも可）") : "";
    if (note === null) return;
    await post({ review: { table, id, verdict, note } });
    router.refresh();
  };
  return (
    <span className="inline-flex gap-2 text-xs">
      <button type="button" className="underline" style={current === "ok" ? { color: "var(--good)", fontWeight: 700 } : undefined} onClick={() => send("ok")}>問題なし</button>
      <button type="button" className="underline" style={current === "bad" ? { color: "var(--critical)", fontWeight: 700 } : undefined} onClick={() => send("bad")}>出すべきでなかった</button>
    </span>
  );
}

// AIからのお願いに答える
export function AnswerRequest({ id }: { id: number }) {
  const router = useRouter();
  const send = async (status: "done" | "declined") => {
    const note = window.prompt(status === "done" ? "やったこと・気づいたこと（空でも可）" : "やらない理由（空でも可。AIが次から避けます）");
    if (note === null) return;
    await post({ answer: { id, status, note } });
    router.refresh();
  };
  return (
    <span className="inline-flex gap-2">
      <button type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs" onClick={() => send("done")}>やった</button>
      <button type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs" onClick={() => send("declined")}>やらない</button>
    </span>
  );
}
