"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";
import { DecisionCard } from "./DecisionCard";
import { jstDateTime } from "@/lib/format";
import { plainIssue } from "@/lib/issueText";
import { hasUnpublishedVersion, versionLabel } from "@/lib/versionLabel";

export type ApprovalView = {
  id: number;
  kind: "idea" | "publish" | "decision" | "data";
  proposal: string;
  reason: string;
  createdAt: string;
  project: { id: number; title: string; target: string; problem: string; solution: string; hypothesis: string; confidence: number | null; demo: boolean; kind: "lp" | "tool"; lpVersion: number; publicVersion: number | null; deep: boolean };
  // じっくり案件のデータの確認。sample（中身の例）は運営者にだけ入る
  // error: 下書きに失敗したとき（id は null）。owner: 運営者が見ているか（データを自分で入れられる）
  data?: { id: number | null; count: number; groups: number; note: string; fields: { key: string; label: string; kind: "fact" | "view" }[]; sample?: Record<string, unknown>[]; error?: string; owner: boolean };
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
  data: { label: "データの確認", approve: "このデータで作る", after: "承認すると、AIがこのデータを使ってツールを作ります（そのあと、公開の承認があります）。修正を指示すると、データを作り直します。", busy: "AIがツールを作っています…" },
  publish: { label: "公開", approve: "公開して集客を始める", after: "承認すると公開されて「公開中・集客中」になります（広告の出稿は手動）。", busy: "処理しています…" },
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
        {a.project.deep && <span className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">じっくり案件</span>}
        <Link href={`/projects/${a.project.id}`} className="text-accent underline">{a.project.title}</Link>
        {a.project.demo && <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5">デモ</span>}
        <span className="num">{jstDateTime(a.createdAt)}</span>
      </div>

      <div>
        <div className="text-xs text-muted">AIの提案</div>
        <h3 className="font-bold">{a.proposal}</h3>
        <p className="mt-1 text-sm text-ink-2">{shortReason(a)}</p>
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

      {a.kind === "data" && a.data && <DataCheck d={a.data} approvalId={a.id} />}

      {a.kind === "publish" && (
        <div className="space-y-2">
          {a.review && (
            <div className="text-sm">
              {a.review.ok ? (
                <span style={{ color: "var(--good)" }}>✓ AIのチェック: 誇大表現・架空の実績などの問題なし</span>
              ) : (
                <div style={{ color: "var(--critical)" }}>
                  ! AIのチェックで問題が残っています
                  <ul className="ml-5 list-disc text-ink-2">{a.review.issues.map((x) => <li key={x}>{plainIssue(x)}</li>)}</ul>
                </div>
              )}
            </div>
          )}
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/lp/${a.project.id}?v=${a.project.lpVersion}`} target="_blank" className="text-accent underline">
              {versionLabel({ lp_version: a.project.lpVersion, public_version: a.project.publicVersion }, a.project.lpVersion)}を{a.project.kind === "tool" ? "触って確かめる" : "見る"} ↗
            </Link>
            {hasUnpublishedVersion({ lp_version: a.project.lpVersion, public_version: a.project.publicVersion }) && (
              <Link href={`/lp/${a.project.id}/compare`} target="_blank" className="text-accent underline">公開中の第{a.project.publicVersion}版と見比べる ↗</Link>
            )}
          </span>
          {a.review && !a.review.ok && a.review.issues.length > 0 && (
            <AutoFix approvalId={a.id} issues={a.review.issues} isTool={a.project.kind === "tool"} />
          )}
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

      <p className="text-xs text-muted">{a.kind === "data" && !a.data?.id ? "修正を指示すると、データを作り直します。データを自分で入れると、承認できるようになります。" : k.after}</p>

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
            {!(a.kind === "data" && !a.data?.id) && <ActionButton variant="primary" disabled={!!busy} onClick={() => send("approve", k.busy)}>✓ {k.approve}</ActionButton>}
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

// じっくり案件のデータ: 項目（事実か見立てか）と、全体から等間隔に取った例。全部は JSON で保存して確かめられる
// 下書きに失敗したときは理由を出す。運営者は、公式の表などのデータを自分で入れて差し替えられる
function DataCheck({ d, approvalId }: { d: NonNullable<ApprovalView["data"]>; approvalId: number }) {
  if (!d.id) {
    return (
      <div className="space-y-2 text-sm">
        <p style={{ color: "var(--critical)" }}>データを作れませんでした: {d.error}</p>
        {d.owner && <UploadData approvalId={approvalId} fields={d.fields} />}
      </div>
    );
  }
  return (
    <div className="space-y-2 text-sm">
      <p className="text-ink-2">{d.count.toLocaleString("ja-JP")}件{d.groups > 0 ? `（${d.groups}グループに分けて作成）` : ""}</p>
      {d.note && <p className="text-xs text-ink-2">{d.note}</p>}
      <ul className="flex flex-wrap gap-1.5 text-xs">
        {d.fields.map((f) => (
          <li key={f.key} className="rounded border border-line px-1.5 py-0.5">
            {f.label}<span className="ml-1 text-muted">{f.kind === "fact" ? "事実" : "見立て"}</span>
          </li>
        ))}
      </ul>
      {d.sample ? (
        <>
          <div className="max-h-72 overflow-auto rounded-lg border border-line">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                <tr>{d.fields.map((f) => <th key={f.key} className="whitespace-nowrap px-2 py-1 font-normal">{f.label}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.sample.map((r, i) => (
                  <tr key={i}>{d.fields.map((f) => <td key={f.key} className="px-2 py-1 align-top">{String(r[f.key] ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            全体から等間隔に{d.sample.length}件を出しています。
            <a href={`/api/deep-data/${d.id}`} className="ml-1 text-accent underline">全部を JSON で保存して確かめる</a>
          </p>
        </>
      ) : (
        <p className="text-xs text-muted">データの中身は、運営者だけが見られます。</p>
      )}
      {d.owner && <UploadData approvalId={approvalId} fields={d.fields} />}
    </div>
  );
}

// 運営者がデータを自分で入れる（CSV か JSON）。ファイルを選ぶか、貼り付ける。入れたあとも、承認するまではツールを作らない
function UploadData({ approvalId, fields }: { approvalId: number; fields: NonNullable<ApprovalView["data"]>["fields"] }) {
  const { run, busy, error } = useLoopAction();
  const [text, setText] = useState("");
  return (
    <details className="rounded-lg border border-line p-3">
      <summary className="cursor-pointer text-xs text-accent">データを自分で入れて差し替える（CSV か JSON）</summary>
      <div className="mt-2 space-y-2">
        <p className="text-xs text-ink-2">
          公式の表など、AIの下書きより正確なデータがあるときに使います。CSV は1行目を見出しにしてください。
          {fields.length > 0 ? <> 見出しは次の名前か key にします: {fields.map((f) => `${f.label}（${f.key}）`).join("・")}。ない列は空欄になります。</> : " 見出しが、そのままデータの項目になります。"}
        </p>
        <input
          type="file"
          accept=".csv,.json,text/csv,application/json"
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }}
          className="block text-xs"
        />
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder="ここに貼り付けることもできます" className="w-full rounded-lg border border-line bg-surface p-2 font-mono text-xs" />
        <ActionButton disabled={!!busy || !text.trim()} onClick={() => run("データを取り込んでいます…", { action: "deep-upload", approvalId, text })}>このデータに差し替える</ActionButton>
        <BusyNote busy={busy} error={error} />
      </div>
    </details>
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

// チェックの指摘に沿って、AIに直させる（そのまま直させるか、直す内容を確認・書き足してから送る）
function AutoFix({ approvalId, issues, isTool }: { approvalId: number; issues: string[]; isTool: boolean }) {
  const { run, busy, error } = useLoopAction();
  const draft = `AIのチェックで見つかった次の問題だけを直すこと。それ以外（世界観・見た目・文言・機能）は今のまま残す。\n${issues.map((x, i) => `${i + 1}. ${x.replace(/^デザイン: /, "")}`).join("\n")}`;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft);
  const label = isTool ? "AIがツールと紹介ページを直しています（数分かかります）…" : "AIがLPを直しています（数分かかります）…";
  return (
    <div className="space-y-2 rounded-lg bg-surface-2 p-3">
      <div className="text-sm font-medium">指摘に沿って直させる</div>
      <p className="text-xs text-muted">チェックで出た問題だけを直させます。直した版はもう一度チェックし、通れば全自動の案件はそのまま公開されます。通らなければ、またここに戻ってきます（1回 約50〜200円）。</p>
      {editing && (
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={2000} className="block w-full rounded-lg border border-line bg-surface p-2 text-sm" />
      )}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <ActionButton variant="primary" disabled={!!busy || !text.trim()} onClick={() => run(label, { action: "auto-fix", approvalId, instruction: text })}>この指示で直させる</ActionButton>
            <ActionButton disabled={!!busy} onClick={() => { setEditing(false); setText(draft); }}>やめる</ActionButton>
          </>
        ) : (
          <>
            <ActionButton variant="primary" disabled={!!busy} onClick={() => run(label, { action: "auto-fix", approvalId })}>指摘どおりに直させる</ActionButton>
            <ActionButton disabled={!!busy} onClick={() => setEditing(true)}>直す内容を確認してから</ActionButton>
          </>
        )}
      </div>
      <BusyNote busy={busy} error={error} />
    </div>
  );
}

// チェックで止めた公開の理由は「…自動公開を止めました: 指摘1 / 指摘2」の形で、指摘は下の箇条書きと同じ中身。
// 同じ文が2回並ばないように、箇条書きを出すときは「: 」より後ろを切る（保存してある理由は変えないので、過去の分にも効く）
function shortReason(a: ApprovalView): string {
  const issues = a.review && !a.review.ok ? a.review.issues : [];
  const i = a.reason.indexOf(": ");
  if (!issues.length || i < 0 || !a.reason.includes(issues[0])) return a.reason;
  return `${a.reason.slice(0, i)}。指摘は下のとおりです。`;
}
