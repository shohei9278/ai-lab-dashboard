"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { IdeaForm } from "@/components/IdeaForm";
import { MeetingForm } from "../meetings/MeetingForm";

// ホームのライブの欄に置く、運営者の指示のボタン。押すと、上のオフィスとライブにそのまま動きが流れる
// 長くならないよう、選んだものの入力欄だけを開く（それぞれの画面にある入力欄と同じものを使う）
type Props = {
  meeting: { members: { id: string; label: string; color: string }[]; running: string | null };
  ideaAuthors: string[];
  viral: { ready: boolean; yen: number };
};
type Pick = "meeting" | "idea" | "viral" | null;

export function OwnerActions({ meeting, ideaAuthors, viral }: Props) {
  const [open, setOpen] = useState<Pick>(null);
  const tab = (k: Exclude<Pick, null>, label: string) => (
    <button
      type="button"
      aria-expanded={open === k}
      onClick={() => setOpen(open === k ? null : k)}
      className={`rounded-lg border px-3 py-1 text-xs ${open === k ? "border-accent bg-accent font-bold text-accent-ink" : "border-line hover:bg-surface-2"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">指示を出す:</span>
        {tab("meeting", meeting.running ? "会議中…" : "今すぐ会議")}
        {tab("idea", "AIにアイデアを出させる")}
        {tab("viral", "話題の投稿を集める")}
      </div>
      {open === "meeting" && <MeetingForm members={meeting.members} running={meeting.running} />}
      {open === "idea" && <IdeaForm authors={ideaAuthors} />}
      {open === "viral" && <ViralSearch {...viral} />}
    </div>
  );
}

// X で話題の投稿と「欲しい」の声を今すぐ検索する（件数や週1回の自動検索の設定は、話題の投稿の画面で変える）
function ViralSearch({ ready, yen }: { ready: boolean; yen: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!ready) return <p className="text-xs" style={{ color: "var(--critical)" }}>X の APIキーが設定されていないため、検索できません。</p>;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <button
        type="button"
        disabled={busy}
        className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          const res = await fetch("/api/viral", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "search" }) });
          const data = (await res.json().catch(() => ({}))) as { read?: number; added?: number; wants?: number; wantsError?: string; error?: string };
          setBusy(false);
          setMsg(res.ok ? `${data.read}件を読み、話題の投稿を${data.added}件・「欲しい」の声を${data.wants}件取り込みました${data.wantsError ? `（声の検索は失敗: ${data.wantsError}）` : ""}` : data.error ?? "検索できませんでした");
          router.refresh();
        }}
      >
        {busy ? "検索しています…" : `X で話題の投稿と「欲しい」の声を検索する（約${yen}円）`}
      </button>
      <a href="/viral" className="text-accent underline">件数と自動検索の設定</a>
      {msg && <span className="basis-full text-ink-2">{msg}</span>}
    </div>
  );
}
