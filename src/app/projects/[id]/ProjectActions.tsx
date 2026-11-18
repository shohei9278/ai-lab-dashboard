"use client";

import { useState } from "react";
import type { Stage } from "@/lib/db";
import { ActionButton, BusyNote, useLoopAction } from "@/components/LoopAction";

export function ProjectActions({ id, convNoun, stage, hasLp, hasPending, judgeMinVisits, publicUrl, isTool, building, demo, deepNoData = false, needs = null }: {
  // 人の作業待ち（まだない仕組みが要るじっくり案件）。要るものの一覧
  needs?: { label: string; what: string; why: string; ready: boolean }[] | null;
  id: number; convNoun: string; stage: Stage; hasLp: boolean; hasPending: boolean; judgeMinVisits: number; isTool: boolean; demo: boolean;
  deepNoData?: boolean; // じっくり案件で、まだ承認したデータがない（止まっていたら、ツールではなくデータの下書きからやり直す）
  building: { what: string; since: number } | null; // AIが今作業中なら、その内容
  publicUrl: string | null; // 実際に公開しているときだけ入る
}) {
  const { run, busy, error } = useLoopAction();
  const [visits, setVisits] = useState("");
  const [signups, setSignups] = useState("");
  const [adSpend, setAdSpend] = useState("");

  // 作成・修正の途中で止まったとき用（AIの呼び出しの失敗や、作業中のサーバーの立ち上げ直し。サーバー側の isStuck と同じ条件）
  const stuck = !hasPending && !building && (stage === "idea" || stage === "lp");
  const thing = isTool ? "ツール" : "LP";

  // 実際に公開しているLPは、訪問と登録が自動で入る。人が入れるのは広告費だけ
  if (stage === "live" && publicUrl) {
    return (
      <div className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">公開中</h2>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="text-sm text-accent underline">{publicUrl} ↗</a>
          <p className="mt-1 text-xs text-muted">
            訪問と{convNoun}の数は5分ごとに自動で取り込みます。訪問が{judgeMinVisits}人を超えるか、広告費が上限に達すると、AIが判断して承認待ちに出します。
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <Num label="広告費（円）" value={adSpend} onChange={setAdSpend} />
          <ActionButton
            disabled={!!busy || adSpend === ""}
            onClick={async () => {
              if (await run("記録しています…", { action: "metrics", projectId: id, visits: 0, signups: 0, adSpendJpy: adSpend })) setAdSpend("");
            }}
          >
            広告費を記録する
          </ActionButton>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <ActionButton disabled={!!busy} onClick={() => run("取り込んでいます…", { action: "sync" })}>数字を今すぐ取り込む</ActionButton>
          <ActionButton disabled={!!busy} onClick={() => run("AIが判断しています…", { action: "judge", projectId: id })}>今すぐAIに判断させる</ActionButton>
        </div>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }

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
          <Num label={convNoun} value={signups} onChange={setSignups} />
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
          {/* 架空の数字で本物の案件が判断・撤退しないよう、シミュレーションはデモ案件だけ */}
          {demo && (
            <ActionButton disabled={!!busy} onClick={() => run("シミュレーションしています…", { action: "simulate", projectId: id, days: 3 })}>
              3日分をシミュレーション（ダミー）
            </ActionButton>
          )}
          <ActionButton disabled={!!busy} onClick={() => run("AIが判断しています…", { action: "judge", projectId: id })}>
            今すぐAIに判断させる
          </ActionButton>
        </div>
        <p className="text-xs text-muted">シミュレーションは、実際に広告を出す前に流れを試すための架空の数字です。結果の画面にもその旨が表示されます。</p>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }

  if (building) {
    return (
      <div className="card p-4 text-sm text-ink-2">
        <span aria-hidden style={{ color: "var(--accent)" }}>◐</span> AIが{building.what}（{Math.max(1, Math.round((Date.now() - building.since) / 60000))}分前から）。終わると自動で次に進みます。ページを開き直すと最新の状態になります。
      </div>
    );
  }

  if (needs && needs.length && stage === "idea" && !hasPending) {
    return (
      <div className="card space-y-2 p-4">
        <h2 className="font-bold">人の作業待ち</h2>
        <p className="text-sm text-ink-2">作るのに、今はまだない仕組みや、人が用意するものが要るため、作り始める前に止めています。用意できたら「済み」にすると、作り始めます（データが要るならデータの下書き、なければ設計書を書いて開発待ちへ）。</p>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {needs.map((n, i) => <li key={i}><span className="font-medium">{n.label}</span>: {n.what}{n.why ? <span className="text-ink-2">（{n.why}）</span> : null}{!n.ready && <span className="ml-1 text-xs" style={{ color: "var(--warning)" }}>（この仕組みはまだありません）</span>}</li>)}
        </ul>
        {needs.some((n) => !n.ready) && <p className="text-xs text-muted">まだない仕組みが要るため、まだ「済み」にできません。その仕組みを作るとき（ツールから使えるようにするとき）に、押せるようになります。</p>}
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="primary" disabled={!!busy || needs.some((n) => !n.ready)} onClick={() => run("受け付けています…", { action: "needs-done", projectId: id })}>
            用意した（済み）・作り始める
          </ActionButton>
          <Abandon id={id} />
        </div>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }

  if (stuck && deepNoData && stage === "idea") {
    return (
      <div className="card space-y-2 p-4">
        <p className="text-sm text-ink-2">じっくり案件のデータの下書きが途中で止まっています（AIの呼び出しに失敗したか、下書きの途中でサーバーが止まった可能性があります）。</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="primary" disabled={!!busy} onClick={() => run("AIがデータを下書きしています…（数分〜十数分かかります）", { action: "deep-retry", projectId: id })}>
            データの下書きをやり直す
          </ActionButton>
          <Abandon id={id} />
        </div>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }
  // 版があるとき: ツールの取り込み・紹介ページづくり・修正の途中で止まった。止まる前の操作からやり直す（取り込みなら開発待ちに戻すだけで、AIは呼ばない）
  if (stuck && hasLp) {
    return (
      <div className="card space-y-2 p-4">
        <p className="text-sm text-ink-2">{isTool ? "ツールの取り込みや紹介ページづくり、" : ""}修正が途中で止まっていて、判断待ちがありません（AIの呼び出しに失敗したか、作業中にサーバーが止まった可能性があります）。今の版はそのままです。</p>
        <p className="text-xs text-muted">「やり直す」を押すと、止まる前の操作からやり直します。ツールのHTMLを入れたところで止まったときは開発待ちに戻るので、同じHTMLをもう一度入れてください（AIは呼びません）。修正の途中で止まったときは、同じ指示で直し直します。</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="primary" disabled={!!busy} onClick={() => run("やり直しています…", { action: "generate-lp", projectId: id })}>
            やり直す
          </ActionButton>
          {!publicUrl && <Abandon id={id} />}
        </div>
        <BusyNote busy={busy} error={error} />
      </div>
    );
  }
  if (stuck) {
    return (
      <div className="card space-y-2 p-4">
        <p className="text-sm text-ink-2">{thing}の作成が途中で止まっています（AIの呼び出しに失敗したか、作成中にサーバーが止まった可能性があります）。</p>
        <div className="flex flex-wrap gap-2">
          <ActionButton variant="primary" disabled={!!busy} onClick={() => run(`AIが${thing}を作っています…`, { action: "generate-lp", projectId: id })}>
            {thing}を作り直す
          </ActionButton>
          {!publicUrl && <Abandon id={id} />}
        </div>
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

// 作成が止まった案件を見送る。理由は任意（経過に残る）。案件と記録は消さず、結果の「見送り」に移る
function Abandon({ id }: { id: number }) {
  const { run, busy, error } = useLoopAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <ActionButton disabled={!!busy} onClick={() => setOpen(true)}>見送る</ActionButton>;
  return (
    <div className="w-full space-y-2 rounded-lg border border-line p-3">
      <label className="block text-xs text-ink-2">
        見送る理由（任意。経過に残ります）
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="例: 前の作りで作った案件のため" className="mt-1 block w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm" />
      </label>
      <p className="text-xs text-muted">見送っても、案件と記録（費用・経過・AIの入出力）は残り、案件の一覧の「結果」に「見送り」として並びます。</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="danger" disabled={!!busy} onClick={() => run("見送っています…", { action: "abandon", projectId: id, reason })}>見送りを決める</ActionButton>
        <ActionButton disabled={!!busy} onClick={() => setOpen(false)}>やめる</ActionButton>
      </div>
      <BusyNote busy={busy} error={error} />
    </div>
  );
}
