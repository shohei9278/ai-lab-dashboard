"use client";

import { useState } from "react";
import type { Stage } from "@/lib/db";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

export function ProjectActions({ id, stage, hasLp, hasPending, judgeMinVisits }: {
  id: number; stage: Stage; hasLp: boolean; hasPending: boolean; judgeMinVisits: number;
}) {
  const { run, busy, error } = useLoopAction();
  const [visits, setVisits] = useState("");
  const [signups, setSignups] = useState("");
  const [adSpend, setAdSpend] = useState("");

  // 承認後にAI呼び出しが失敗して止まったとき用
  const stuck = !hasPending && (stage === "idea" || (stage === "lp" && !hasLp));

  if (stage === "live") {
    return (
      <div className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">集客データを入れる</h2>
          <p className="text-xs text-muted">
            訪問が合計{judgeMinVisits}人を超えるか、広告費が上限に達すると、AIが自動で「続ける・改善・撤退」を判断して承認待ちに出します。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Num label="訪問" value={visits} onChange={setVisits} />
          <Num label="登録" value={signups} onChange={setSignups} />
          <Num label="広告費（円）" value={adSpend} onChange={setAdSpend} />
          <ActionButton
            disabled={!!busy || visits === "" || signups === ""}
            onClick={async () => {
              if (await run("記録しています…", { action: "metrics", projectId: id, visits, signups, adSpendJpy: adSpend || 0 })) {
                setVisits(""); setSignups(""); setAdSpend("");
              }
            }}
          >
            記録する
          </ActionButton>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <ActionButton disabled={!!busy} onClick={() => run("シミュレーションしています…", { action: "simulate", projectId: id, days: 3 })}>
            3日分をシミュレーション（ダミー）
          </ActionButton>
          <ActionButton disabled={!!busy} onClick={() => run("AIが判断しています…", { action: "judge", projectId: id })}>
            今すぐAIに判断させる
          </ActionButton>
        </div>
        <p className="text-xs text-muted">シミュレーションは、実際に広告を出す前に流れを試すための架空の数字です。結果の画面にもその旨が表示されます。</p>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }

  if (stuck) {
    return (
      <div className="card space-y-2 p-4">
        <p className="text-sm text-ink-2">LPの作成が途中で止まっています（AIの呼び出しに失敗した可能性があります）。</p>
        <ActionButton variant="primary" disabled={!!busy} onClick={() => run("AIがLPを作っています…", { action: "generate-lp", projectId: id })}>
          LPを作り直す
        </ActionButton>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }
  return null;
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="text-xs text-ink-2">
      {label}
      <input
        type="number" min={0} value={value} onChange={(e) => onChange(e.target.value)}
        className="num mt-1 block w-28 rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
      />
    </label>
  );
}
