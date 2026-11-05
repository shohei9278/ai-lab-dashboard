"use client";

import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";
import { jstDateTime } from "@/lib/format";

type Test = { ok: boolean; skipped?: string; errors: string[]; clicked: number; changed: boolean; overflow: boolean; screenshot?: string; at: string };

// 動くツールの、ブラウザでの自動テストの結果（スマホ幅で開いて、ボタンなどを押してみる）
export function ToolTestCard({ id, version, test }: { id: number; version: number; test: Test | null }) {
  const { run, busy, error } = useLoopAction();
  const issues = test && !test.skipped
    ? [...test.errors, ...(test.clicked > 0 && !test.changed ? ["押しても画面が変わらない"] : []), ...(test.clicked === 0 ? ["押せる所が見つからない"] : []), ...(test.overflow ? ["スマホ幅で横にはみ出している"] : [])]
    : [];
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">ブラウザでの自動テスト（第{version}版）</h2>
          <p className="text-xs text-muted">スマホの画面幅でツールを開き、入力欄に値を入れて、ボタンなどを順に押します。エラー・結果が出ない・横へのはみ出しがないかを確かめます。</p>
        </div>
        <ActionButton disabled={!!busy} onClick={() => run("ブラウザで動かしています…", { action: "test-tool", projectId: id })}>もう一度テストする</ActionButton>
      </div>
      {!test ? (
        <p className="text-sm text-ink-2">まだテストしていません。</p>
      ) : test.skipped ? (
        <p className="text-sm text-ink-2">{test.skipped}</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          <div className="min-w-0 flex-1 space-y-1 text-sm">
            <div style={{ color: issues.length ? "var(--critical)" : "var(--good)" }}>
              {issues.length ? `! 問題が${issues.length}件あります` : "✓ 問題なし"}
              <span className="ml-2 text-xs text-muted">{test.clicked}か所を操作・{jstDateTime(test.at)}</span>
            </div>
            {issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">{issues.map((x) => <li key={x}>{x}</li>)}</ul>}
          </div>
          {test.screenshot && (
            <a href={`/api/screenshots/${test.screenshot}`} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/screenshots/${test.screenshot}?t=${encodeURIComponent(test.at)}`} alt="テスト後のスマホ画面" className="max-h-72 w-auto rounded-lg border border-line" />
            </a>
          )}
        </div>
      )}
      <BusyNote busy={busy} error={error} />
    </section>
  );
}
