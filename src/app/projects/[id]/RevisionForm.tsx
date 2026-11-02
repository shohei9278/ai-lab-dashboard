"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

// 今のLP・ツールへの修正を、案件の画面から指示する
export function RevisionForm({ id, isTool, isPublic }: { id: number; isTool: boolean; isPublic: boolean }) {
  const { run, busy, error } = useLoopAction();
  const [text, setText] = useState("");
  const [keepCore, setKeepCore] = useState(true);
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">{isTool ? "ツールの修正を指示する" : "LPの修正を指示する"}</h2>
        <p className="text-xs text-muted">
          AIが新しい版を作り、チェックしてから公開の承認待ちに出します。
          {isPublic ? "承認するまでは、今公開中の版がそのまま表示されます。" : ""}
          費用の目安は{isTool ? "1回 約45円（ツール本体も作り直すため）" : "1回 約6円"}です。
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder={isTool ? "例: 結果の画面に、もう一度やり直すボタンを付けて" : "例: 見出しを、店長が自分ごとに感じる言い方に変えて"}
        className="block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        aria-label="修正の内容"
      />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={keepCore} onChange={(e) => setKeepCore(e.target.checked)} />
        <span>
          指示した所だけ変える
          <span className="block text-xs text-muted">外すと、指示をふまえてAIが全体を見直します（対象読者や仮説が変わることもあります）。</span>
        </span>
      </label>
      <ActionButton
        variant="primary"
        disabled={!!busy || !text.trim()}
        onClick={async () => {
          if (await run(isTool ? "AIがツールを直しています（1〜2分）…" : "AIがLPを直しています…", { action: "revise", projectId: id, instruction: text, keepCore })) setText("");
        }}
      >
        修正を指示する
      </ActionButton>
      <BusyNote busy={busy} error={error} />
    </section>
  );
}
