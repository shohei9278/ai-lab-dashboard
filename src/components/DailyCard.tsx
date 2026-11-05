"use client";

import Link from "next/link";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";
import { useIdeaBusy } from "./useIdeaBusy";

export function DailyCard({ enabled, hour, lastRun, lastMessage, count, keep, modeLabel }: {
  enabled: boolean; hour: number; lastRun: string; lastMessage: string | null; count: number; keep: number; modeLabel: string;
}) {
  const { run, busy, error } = useLoopAction();
  const ideaBusy = useIdeaBusy();
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">
            毎日の自動アイデア出し
            <span className="ml-2 text-sm font-normal" style={{ color: enabled ? "var(--good)" : "var(--muted)" }}>
              {enabled ? "● 有効" : "○ 無効"}
            </span>
          </h2>
          <p className="text-xs text-muted">
            毎日{hour}時以降に、3社のAIが{count}件ずつアイデアを出し、作者を伏せて3社で採点して上位を最大{keep}件進めます（月の予算のペースに合わせて、件数は自動で減らします）。進め方: {modeLabel}。
            <Link href="/settings" className="ml-1 underline">設定</Link>
          </p>
        </div>
        <ActionButton
          disabled={!!busy || !!ideaBusy}
          onClick={() => run("AIがアイデアを出して選別しています…（1〜2分ほど）", { action: "daily" })}
        >
          今すぐ1回実行
        </ActionButton>
      </div>
      <p className="text-sm text-ink-2">
        最後の実行: {lastRun || "まだありません"}
        {lastMessage && <span className="block text-xs text-muted">{lastMessage}</span>}
      </p>
      {ideaBusy && !busy && <p className="text-xs text-muted">いま「{ideaBusy}」が動いています。終わると押せるようになります。</p>}
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
