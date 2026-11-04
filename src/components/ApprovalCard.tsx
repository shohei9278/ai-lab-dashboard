"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";
import { DecisionCard } from "./DecisionCard";

export type ApprovalView = {
  id: number;
  kind: "idea" | "publish" | "decision";
  proposal: string;
  reason: string;
  createdAt: string;
  project: { id: number; title: string; target: string; problem: string; solution: string; hypothesis: string; confidence: number | null; demo: boolean; kind: "lp" | "tool" };
  conv: { noun: string; rate: string }; // 成果の呼び方（事前登録LPは登録、動くツールは利用）
  decision?: { confidence: number; nextAction: string };
  review?: { ok: boolean; issues: string[] };
  totals?: { visits: number; signups: number; rate: number; adSpendJpy: number; simulated: boolean };
  targetRate: number;
  // 判断の2段階用。others と debate は、最初の判断を記録したあとにだけ入る
  judge?: {
    adBudgetJpy: number;
    lpVersion: number;
    primaryModel: string;
    primaryDecision: string;
    initialChoice: string | null;
    others: { modelId: string; label: string; provider: string; decision: string | null; confidence: number | null; reason: string | null; error: string | null }[];
    othersPending: boolean;
    debate: { status: string; issue?: string; missingInfo?: string; positions?: { label: string; provider: string; first: string; final: string; argument: string; changed: boolean }[] } | null;
  };
};

const KIND = {
  idea: { label: "アイデアの採用", approve: "このアイデアで進める", after: "承認すると、AIがLP（動くツールの場合はツール本体も）を作ります。", busy: "AIが作っています…" },
  publish: { label: "公開", approve: "公開して集客を始める", after: "承認すると公開されて「集客中」になります（広告の出稿は手動）。", busy: "処理しています…" },
  decision: {
    label: "AIの判断",
    approve: "この判断に従う",
    after: "承認すると判断が実行されます（改善ならAIがLPやツールを作り直し、続ける・撤退ならAIが教訓をメモします）。",
    busy: "AIが処理しています…",
  },
} as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function ApprovalCard({ a }: { a: ApprovalView }) {
  if (a.kind === "decision" && a.judge) return <DecisionCard a={a} />;
  return <SimpleApprovalCard a={a} />;
}

function SimpleApprovalCard({ a }: { a: ApprovalView }) {
  const { run, busy, error } = useLoopAction();
  const [revising, setRevising] = useState(false);
  const [comment, setComment] = useState("");
  const k = KIND[a.kind];

  const send = (decision: "approve" | "reject" | "revise", label: string) =>
    run(label, { action: "decide", approvalId: a.id, decision, comment: decision === "revise" ? comment : undefined });

  return (
    <article className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded border border-line px-1.5 py-0.5 text-ink-2">{k.label}</span>
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">{a.project.kind === "tool" ? "動くツール" : "事前登録LP"}</span>
        <Link href={`/projects/${a.project.id}`} className="text-accent underline">{a.project.title}</Link>
        {a.project.demo && <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5">デモ</span>}
        <span className="num">{a.createdAt.slice(5, 16)}</span>
      </div>

      <div>
        <div className="text-xs text-muted">AIの提案</div>
        <h3 className="font-bold">{a.proposal}</h3>
        <p className="mt-1 text-sm text-ink-2">{a.reason}</p>
      </div>

      {a.kind === "idea" && (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Item label="誰向け">{a.project.target}</Item>
          <Item label="困りごと">{a.project.problem}</Item>
          <Item label="解決策">{a.project.solution}</Item>
          <Item label="検証する仮説">{a.project.hypothesis}</Item>
          {a.project.confidence !== null && <Item label="AIの自信度">{Math.round(a.project.confidence * 100)}%</Item>}
        </dl>
      )}

      {a.kind === "publish" && (
        <div className="space-y-2">
          {a.review && (
            <div className="text-sm">
              {a.review.ok ? (
                <span style={{ color: "var(--good)" }}>✓ AIのチェック: 誇大表現・架空の実績などの問題なし</span>
              ) : (
                <div style={{ color: "var(--critical)" }}>
                  ! AIのチェックで問題が残っています
                  <ul className="ml-5 list-disc text-ink-2">{a.review.issues.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          <Link href={`/lp/${a.project.id}`} target="_blank" className="inline-block text-sm text-accent underline">
            {a.project.kind === "tool" ? "ツールを実際に触って確かめる ↗" : "作成されたLPを見る ↗"}
          </Link>
        </div>
      )}

      {a.kind === "decision" && a.totals && (
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          <Item label="訪問">{a.totals.visits}人</Item>
          <Item label={a.conv.noun}>{a.totals.signups}人</Item>
          <Item label={`${a.conv.rate}（目標）`}>{pct(a.totals.rate)}（{pct(a.targetRate)}）</Item>
          <Item label="AIの自信度">{a.decision ? `${Math.round(a.decision.confidence * 100)}%` : "—"}</Item>
          {a.decision && <div className="sm:col-span-4"><Item label="次にやること">{a.decision.nextAction}</Item></div>}
          {a.totals.simulated && <p className="text-xs text-muted sm:col-span-4">※ 集客データにシミュレーションが含まれます</p>}
        </dl>
      )}

      <p className="text-xs text-muted">{k.after}</p>

      {revising && (
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          maxLength={500}
          placeholder="例: ターゲットを個人ではなく小さな会社に変えて"
          className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
        />
      )}

      <div className="flex flex-wrap gap-2">
        {revising ? (
          <>
            <ActionButton variant="primary" disabled={!!busy || !comment.trim()} onClick={() => send("revise", "AIが指示を反映しています…")}>
              指示を送ってAIに作り直させる
            </ActionButton>
            <ActionButton disabled={!!busy} onClick={() => setRevising(false)}>やめる</ActionButton>
          </>
        ) : (
          <>
            <ActionButton variant="primary" disabled={!!busy} onClick={() => send("approve", k.busy)}>✓ {k.approve}</ActionButton>
            <ActionButton disabled={!!busy} onClick={() => setRevising(true)}>修正を指示</ActionButton>
            <ActionButton variant="danger" disabled={!!busy} onClick={() => send("reject", "処理しています…")}>
              {a.kind === "decision" ? "採用せず集客を続ける" : "却下"}
            </ActionButton>
          </>
        )}
      </div>
      <BusyNote busy={busy} error={error} />
    </article>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
