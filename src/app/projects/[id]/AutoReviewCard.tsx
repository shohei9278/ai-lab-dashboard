"use client";

import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

// 全自動（人の承認なし）で公開したものを、あとから見て印を付ける
export function AutoReviewCard({ id, review, note, at, url }: { id: number; review: "ok" | "bad" | null; note: string | null; at: string | null; url: string | null }) {
  const { run, busy, error } = useLoopAction();
  const [text, setText] = useState("");
  const [stop, setStop] = useState(true);
  return (
    <section className="card space-y-3 p-4" style={review ? undefined : { borderColor: "var(--accent)" }}>
      <div>
        <h2 className="font-bold">AIだけで公開しました（あとから確認）</h2>
        <p className="text-xs text-muted">
          この案件は、人の承認なしでAIが公開しました。{url ? <>公開中のページ（<a href={`${url}?me=1`} target="_blank" rel="noreferrer" className="text-accent underline">開く ↗</a>）を見て、</> : "LPを見て、"}
          出してよかったかの印を付けてください。「AIだけで出したもののうち、人が見てダメだったのは何%か」の記録になります。
        </p>
      </div>
      {review ? (
        <p className="text-sm">
          {review === "ok" ? <span style={{ color: "var(--good)" }}>✓ 問題なし</span> : <span style={{ color: "var(--critical)" }}>! 出すべきでなかった</span>}
          {note && <span className="ml-2 text-ink-2">{note}</span>}
          {at && <span className="ml-2 text-xs text-muted">{at.slice(5, 16)}（UTC）</span>}
        </p>
      ) : (
        <div className="space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="理由（任意。「出すべきでなかった」なら、何がダメだったかを書くとAIの教訓になります）"
            className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <ActionButton disabled={!!busy} onClick={() => run("記録しています…", { action: "human-review", projectId: id, verdict: "ok", note: text })}>問題なし</ActionButton>
            <ActionButton disabled={!!busy} onClick={() => run("記録しています…", { action: "human-review", projectId: id, verdict: "bad", note: text, stop })}>出すべきでなかった</ActionButton>
            <label className="flex items-center gap-1 text-xs text-ink-2">
              <input type="checkbox" checked={stop} onChange={(e) => setStop(e.target.checked)} />
              「出すべきでなかった」なら公開も止める
            </label>
          </div>
        </div>
      )}
      <BusyNote busy={busy} error={error} />
    </section>
  );
}
