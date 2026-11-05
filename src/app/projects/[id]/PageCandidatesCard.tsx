"use client";

import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";
import { jstDateTime } from "@/lib/format";

export type PageCand = {
  id: number; at: string; withRefs: boolean; score: number | null; aiPick: boolean; current: boolean; canSwitch: boolean;
  issues: string[]; shots: string[]; pc?: string;
};

// AIが作った2案（参考なし・参考あり）の画面を並べて見比べ、もう一方に入れ替えられるようにする
export function PageCandidatesCard({ id, reason, cands, isPublic }: { id: number; reason: string | null; cands: PageCand[]; isPublic: boolean }) {
  const { run, busy, error } = useLoopAction();
  const img = (file: string, alt: string) => (
    <a key={file} href={`/api/screenshots/${file}`} target="_blank" rel="noreferrer" className="block shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/screenshots/${file}`} alt={alt} className="h-56 w-auto rounded-lg border border-line" />
    </a>
  );
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">デザインの2案</h2>
        <p className="text-xs text-muted">
          参考なし・参考ありの2案を作り、作り方を伏せてAIが画面で見比べました（{jstDateTime(cands[0]?.at)}）。
          {isPublic ? "入れ替えると、公開中のページにもすぐ反映されます。" : ""}
        </p>
        {reason && <p className="mt-1 text-sm text-ink-2">AIの理由: {reason}</p>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {cands.map((c) => (
          <div key={c.id} className="space-y-2 rounded-lg border p-3" style={{ borderColor: c.current ? "var(--accent)" : "var(--line)" }}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{c.withRefs ? "参考あり" : "参考なし"}</span>
              <span className="num text-ink-2">{c.score ?? "—"}点</span>
              {c.aiPick && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">AIが選んだ案</span>}
              {c.current && <span className="rounded px-1.5 py-0.5 text-xs text-accent-ink" style={{ background: "var(--accent)" }}>いま使っている</span>}
            </div>
            <div className="text-xs" style={{ color: c.issues.length ? "var(--critical)" : "var(--good)" }}>
              {c.issues.length ? `! 直しきれなかった指摘 ${c.issues.length}件` : "✓ 確認で問題なし"}
            </div>
            {c.issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">{c.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {c.shots.slice(0, 4).map((f, i) => img(f, `スマホ ${i + 1}画面目`))}
              {c.pc && img(c.pc, "PC 一番上")}
            </div>
            {!c.current && (
              c.canSwitch ? (
                <ActionButton disabled={!!busy} onClick={() => run("入れ替えています…", { action: "use-page", projectId: id, candidateId: c.id })}>
                  この案に入れ替える
                </ActionButton>
              ) : (
                <p className="text-xs text-muted">この案はページが残っていないため、入れ替えられません（ページを残すようにする前に作った案です）。</p>
              )
            )}
          </div>
        ))}
      </div>
      <BusyNote busy={busy} error={error} />
    </section>
  );
}
