"use client";

import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

type Check = { ok: boolean; issues: string[]; skipped?: string; shots: string[]; pc?: string; at: string };

// AIが自由にデザインしたページの、スクリーンショットでの確認の結果
export function PageCheckCard({ id, version, hasPage, isPublic, check }: { id: number; version: number; hasPage: boolean; isPublic: boolean; check: Check | null }) {
  const { run, busy, error } = useLoopAction();
  const img = (file: string, alt: string) => (
    <a key={file} href={`/api/screenshots/${file}`} target="_blank" rel="noreferrer" className="block shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/screenshots/${file}?t=${encodeURIComponent(check?.at ?? "")}`} alt={alt} className="h-64 w-auto rounded-lg border border-line" />
    </a>
  );
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">ページ全体のデザイン（第{version}版）</h2>
          <p className="text-xs text-muted">
            {hasPage
              ? "AIが世界観を決めて、ページを丸ごと書いています。スマホとPCの画面を撮って、AIが崩れや内容の問題を確かめました。"
              : "今は決まった部品の組み合わせで表示しています。"}
            {isPublic ? "デザインし直す・やめると、公開中のページにもすぐ反映されます。" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ActionButton disabled={!!busy} onClick={() => run("AIがページをデザインしています（3〜6分ほど）…", { action: "page", projectId: id })}>
            {hasPage ? "デザインし直す（約100〜150円）" : "自由なデザインで作る（約100〜150円）"}
          </ActionButton>
          {hasPage && (
            <ActionButton disabled={!!busy} onClick={() => run("戻しています…", { action: "page", projectId: id, mode: "remove" })}>
              部品のLPに戻す
            </ActionButton>
          )}
        </div>
      </div>
      {hasPage && check && (
        check.skipped ? (
          <p className="text-sm text-ink-2">{check.skipped}</p>
        ) : (
          <div className="space-y-2">
            <div className="text-sm" style={{ color: check.issues.length ? "var(--critical)" : "var(--good)" }}>
              {check.issues.length ? `! 直しきれなかった指摘が${check.issues.length}件あります` : "✓ 問題なし"}
              <span className="ml-2 text-xs text-muted">{check.at.slice(5, 16).replace("T", " ")}（UTC）</span>
            </div>
            {check.issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">{check.issues.map((x) => <li key={x}>{x}</li>)}</ul>}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {check.shots.map((f, i) => img(f, `スマホ ${i + 1}画面目`))}
              {check.pc && img(check.pc, "PC 一番上")}
            </div>
          </div>
        )
      )}
      <BusyNote busy={busy} error={error} />
    </section>
  );
}
