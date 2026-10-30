"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";

export function IdeaForm({ modelLabel }: { modelLabel: string }) {
  const { run, busy, error } = useLoopAction();
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(3);

  return (
    <div className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">AIにアイデアを出させる</h2>
        <p className="text-xs text-muted">
          テーマを入れると {modelLabel} が {count}件のアイデアを考えます（空欄ならおまかせ）。過去の教訓も踏まえます。1回あたり数円です。
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          maxLength={200}
          placeholder="例: 小さな飲食店の業務効率化"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
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
          disabled={!!busy}
          onClick={async () => {
            if (await run("AIがアイデアを考えています…（10〜30秒ほど）", { action: "ideas", theme, count })) setTheme("");
          }}
        >
          アイデアを出す
        </ActionButton>
      </div>
      <BusyNote busy={busy} error={error} />
    </div>
  );
}

export function DemoButtons({ hasDemo }: { hasDemo: boolean }) {
  const { run, busy, error } = useLoopAction();
  return (
    <div className="space-y-1">
      <ActionButton
        disabled={!!busy}
        onClick={() =>
          hasDemo
            ? confirm("デモ案件をすべて削除します。よろしいですか？") && run("削除しています…", { action: "clear-demo" })
            : run("デモ案件を作っています…", { action: "seed-demo" })
        }
      >
        {hasDemo ? "デモ案件を消す" : "デモ案件を入れる（AIを使わない）"}
      </ActionButton>
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
