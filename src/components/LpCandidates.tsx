"use client";

import Link from "next/link";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";

export type CandidateView = {
  id: number;
  label: string;
  author: string | null; // 公開の判断をするまでは伏せる（null）
  provider: string | null;
  avg: number | null;
  headline: string;
  theme: string | null;
  selected: boolean;
  humanSelected: boolean;
  current: boolean;
};

// 3社が作ったLPの候補。公開の承認待ちのあいだは、別の候補に切り替えられる
export function LpCandidates({ projectId, version, items, canSwitch }: { projectId: number; version: number; items: CandidateView[]; canSwitch: boolean }) {
  const { run, busy, error } = useLoopAction();
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <div className="text-xs text-muted">
        第{version}版のLPの候補（{items.length}社が1案ずつ作り、作者を伏せて{items.length}社全員で採点）。
        {canSwitch ? "公開する前なら、別の候補に切り替えられます。" : ""}
        {items.some((c) => c.author === null) ? "作者は、公開の判断をしたあとに表示されます。" : ""}
      </div>
      <ul className="grid gap-2 sm:grid-cols-3">
        {items.map((c) => (
          <li key={c.id} className="space-y-1.5 rounded-lg border p-3 text-sm" style={{ borderColor: c.current ? "var(--accent)" : "var(--border)" }}>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-bold">候補{c.label}</span>
              <span className="num text-ink-2">平均 {c.avg === null ? "—" : c.avg.toFixed(1)}点</span>
              {c.selected && <span className="rounded bg-surface-2 px-1 text-ink-2">AIが選択</span>}
              {c.humanSelected && <span className="rounded bg-surface-2 px-1 text-ink-2">あなたが選択</span>}
              {c.current && <span className="font-medium text-accent">● 今のLP</span>}
            </div>
            <div className="line-clamp-2">{c.headline}</div>
            <div className="text-xs text-muted">
              {c.author ? <span style={c.provider ? { color: `var(--series-${c.provider})` } : undefined}>{c.author}</span> : "作者: 伏せ中"}
              {c.theme ? `・${c.theme}` : ""}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/lp/${projectId}?c=${c.id}`} target="_blank" className="text-xs text-accent underline">見る ↗</Link>
              {canSwitch && !c.current && (
                <ActionButton disabled={!!busy} onClick={() => run("切り替えて、AIがチェックしています…", { action: "use-candidate", candidateId: c.id })}>
                  この案にする
                </ActionButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
