"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

// 案件を保留にする・戻す。公開は続けたまま、宣伝・判断・改善を止める（季節ものなど、今は集客しても届かない案件のため）
export function HoldPanel({ id, held, reason, until, today, blocked }: {
  id: number; held: boolean; reason: string | null; until: string | null; today: string;
  blocked: boolean; // 承認待ちやAIの作業中は、保留にできない
}) {
  const { run, busy, error } = useLoopAction();
  const later = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const [why, setWhy] = useState(reason ?? "");
  const [date, setDate] = useState(until ?? later(30));
  const [seasonal, setSeasonal] = useState(false);

  const form = (
    <div className="space-y-2">
      <label className="block text-xs text-ink-2">
        理由（必須）
        <input
          value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} placeholder="例: 大掃除の話題が増える12月まで待つ"
          className="mt-1 block w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-ink-2">
          再開日（この日に自動で集客へ戻します）
          <input
            type="date" value={date} min={later(1)} max={later(seasonal ? 365 : 90)} onChange={(e) => setDate(e.target.value)}
            className="mt-1 block rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink"
          />
        </label>
        <label className="flex items-center gap-1.5 pb-2 text-xs text-ink-2">
          <input type="checkbox" checked={seasonal} onChange={(e) => setSeasonal(e.target.checked)} />
          季節もの（90日を超えて1年まで）
        </label>
        <ActionButton
          disabled={!!busy || blocked || !why.trim() || !date}
          onClick={() => run("保留にしています…", { action: "hold", projectId: id, reason: why, until: date, seasonal })}
        >
          {held ? "理由と再開日を変更する" : "保留にする"}
        </ActionButton>
      </div>
      {blocked && <p className="text-xs text-muted">承認待ちかAIの作業中のあいだは、変更できません。</p>}
      <BusyNote busy={busy} error={error} />
    </div>
  );

  if (held) {
    return (
      <div className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">⏸ 保留中</h2>
          <p className="mt-1 text-sm text-ink-2">{until}に自動で集客へ戻します。理由: {reason}</p>
          <p className="mt-1 text-xs text-muted">公開と、訪問・利用・外の声の記録は続けています。宣伝の投稿、撤退や継続の判断、ページの改善は止めています。</p>
        </div>
        <ActionButton variant="primary" disabled={!!busy} onClick={() => run("集客に戻しています…", { action: "resume", projectId: id })}>
          今すぐ集客に戻す
        </ActionButton>
        <div className="border-t border-line pt-3">{form}</div>
      </div>
    );
  }

  return (
    <details className="card p-4">
      <summary className="cursor-pointer text-sm font-medium">この案件を保留にする</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-muted">季節ものなど、今は集客しても届かない案件を休ませます。公開と記録は続け、宣伝・判断・改善だけを止めます。AIの成績の利用率には入れません。</p>
        {form}
      </div>
    </details>
  );
}
