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

// 提案箱の提案（AIからのお願い）に答える
export function AnswerRequest({ id }: { id: number }) {
  const router = useRouter();
  const send = async (status: "done" | "declined") => {
    const note = window.prompt(status === "done" ? "やったこと・気づいたこと（空でも可）" : "見送る理由（空でも可。AIが次から同じ提案を避けます）");
    if (note === null) return;
    await post({ answer: { id, status, note } });
    router.refresh();
  };
  return (
    <span className="inline-flex gap-2">
      <button type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs" onClick={() => send("done")}>やった</button>
      <button type="button" className="rounded-lg border border-line px-2 py-0.5 text-xs" onClick={() => send("declined")}>見送り</button>
    </span>
  );
}

// あなたが提案箱に提案を入れる（次の朝会と定例会議で、AIが検討して返事をする）
export function AddProposal() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [how, setHow] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await post({ propose: { title, how } });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) return setMsg(data.error ?? "入れられませんでした");
        setTitle("");
        setHow("");
        setMsg("入れました。次の朝会でAIが返事をします");
        router.refresh();
      }}
    >
      <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required placeholder="題（例: note にも実験の記録を書いてみたら？）" className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
      <textarea value={how} onChange={(e) => setHow(e.target.value)} maxLength={600} rows={2} placeholder="中身・理由（任意）" className="block w-full rounded-lg border border-line bg-surface px-2 py-1 text-sm" />
      <div className="flex items-center gap-3">
        <button type="submit" className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink">提案箱に入れる</button>
        {msg && <span className="text-xs text-ink-2">{msg}</span>}
      </div>
    </form>
  );
}

// 敗者復活の案で案件を作る
export function ReviveIdea({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-lg border border-line px-2 py-0.5 text-xs disabled:opacity-50"
      onClick={async () => {
        if (!confirm("この案で案件を作りますか？（ふだんの作り方で作ります。1件 約100〜300円）")) return;
        setBusy(true);
        const res = await post({ reviveId: id });
        const data = (await res.json().catch(() => ({}))) as { projectId?: number; error?: string };
        setBusy(false);
        if (data.projectId) router.push(`/projects/${data.projectId}`);
        else alert(data.error ?? "作れませんでした");
      }}
    >
      {busy ? "作っています…" : "この案で案件を作る"}
    </button>
  );
}

// 社員の声を、提案箱（仕組みの改善）に入れる
export function PromoteVoice({ id }: { id: number }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="text-xs underline"
      onClick={async () => {
        const res = await post({ promoteVoiceId: id });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) alert(data.error ?? "入れられませんでした");
        router.refresh();
      }}
    >
      提案箱へ
    </button>
  );
}
