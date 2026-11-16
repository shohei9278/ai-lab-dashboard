"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";
import { useIdeaBusy } from "./useIdeaBusy";

// blocked: 新しい案件を作れない理由。あるときは、会議と採点だけ行い案件にしない（アイデアの質の確かめには使える）
export function IdeaForm({ authors, blocked }: { authors: string[]; blocked: string | null }) {
  const { run, busy, error } = useLoopAction();
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(3);
  const ideaBusy = useIdeaBusy();

  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">AIにアイデアを出させる</h2>
        <p className="text-xs text-muted">
          テーマを入れると {authors.join("・")} がそれぞれ{Math.max(2, count)}件ずつ考え、作者を伏せて採点し合い、点数の高い{count}件を案件にします（空欄ならおまかせ）。過去の教訓も踏まえます。1回あたり十数円です。
        </p>
        {blocked && <p className="mt-1 text-xs text-ink-2">いまは{blocked}。押すと会議と採点だけ行い、案件にはしません（会議の記録には残ります）。</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          maxLength={200}
          placeholder="例: 小さな飲食店の業務効率化"
          // 最低限の幅を持たせる（ホームのライブの欄のように狭い所では、潰れずに件数とボタンが次の行に回る）
          className="min-w-[12rem] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
          aria-label="件数"
        >
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}件</option>)}
        </select>
        <ActionButton
          variant="primary"
          disabled={!!busy || !!ideaBusy}
          onClick={async () => {
            if (await run(`3社のAIがアイデアを考えて採点しています…（1〜2分ほど。ホームのライブでも見られます${blocked ? "。今回は案件にしません" : ""}）`, { action: "ideas", theme, count })) setTheme("");
          }}
        >
          アイデアを出す
        </ActionButton>
      </div>
      {ideaBusy && !busy && <p className="text-xs text-muted">いま「{ideaBusy}」が動いています。終わると押せるようになります。</p>}
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
