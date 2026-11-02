"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ApprovalView } from "./ApprovalCard";
import { ActionButton, BusyNote, useLoopAction } from "./LoopAction";

const LABEL: Record<string, string> = {
  continue: "続ける（プロダクト化へ）",
  improve: "LPを改善して再挑戦",
  collect: "今のLPのまま集客を続ける",
  kill: "撤退する",
};
const SHORT: Record<string, string> = { continue: "続ける", improve: "改善", collect: "集客継続", kill: "撤退" };
const CHOICES = ["continue", "improve", "collect", "kill"] as const;
const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;

// 判断の承認待ちは2段階: まず数字だけを見て選び、そのあとAIの意見と議論を見て確定する
export function DecisionCard({ a }: { a: ApprovalView }) {
  const j = a.judge!;
  const t = a.totals!;
  const router = useRouter();
  const { run, busy, error } = useLoopAction();
  const [final, setFinal] = useState<string>(j.initialChoice ?? "");
  const [comment, setComment] = useState("");
  const waiting = !!j.initialChoice && (j.othersPending || j.debate?.status === "running");

  // 他のAIの答えや議論がまだ揃っていなければ、揃うまで画面を更新する
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [waiting, router]);

  return (
    <article className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="rounded border border-line px-1.5 py-0.5 text-ink-2">続ける・撤退の判断</span>
        <Link href={`/projects/${a.project.id}`} className="text-accent underline">{a.project.title}</Link>
        {a.project.demo && <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5">デモ</span>}
        <span className="num">{a.createdAt.slice(5, 16)}</span>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted">集客の結果（第{j.lpVersion}版のLPまで）</div>
        <dl className="grid gap-2 text-sm sm:grid-cols-4">
          <Item label="訪問">{t.visits}人</Item>
          <Item label={a.conv.noun}>{t.signups}人</Item>
          <Item label={`${a.conv.rate}（目標）`}>{pct(t.rate)}（{pct(a.targetRate)}）</Item>
          <Item label="広告費（上限）">{t.adSpendJpy.toLocaleString("ja-JP")}円（{j.adBudgetJpy.toLocaleString("ja-JP")}円）</Item>
        </dl>
        <p className="text-sm"><span className="text-xs text-muted">検証する仮説: </span>{a.project.hypothesis}</p>
        <Link href={`/lp/${a.project.id}`} target="_blank" className="text-sm text-accent underline">{a.project.kind === "tool" ? "今のツールを見る ↗" : "今のLPを見る ↗"}</Link>
        {t.simulated && <p className="text-xs text-muted">※ 集客データにシミュレーションが含まれます</p>}
      </div>

      {!j.initialChoice ? (
        <div className="space-y-2 border-t border-line pt-3">
          <h3 className="font-bold">① まず、あなたの判断を選んでください</h3>
          <p className="text-xs text-muted">
            AIの提案や他のAIの意見は、選んだあとに表示されます。先に見ると判断が引っ張られて、「AIと人の判断がどれだけ一致するか」を正しく測れなくなるためです。
            ここではまだ何も実行されません。
          </p>
          <div className="flex flex-wrap gap-2">
            {CHOICES.map((c) => (
              <ActionButton key={c} disabled={!!busy} onClick={() => run("記録しています…", { action: "initial", approvalId: a.id, choice: c })}>
                {LABEL[c]}
              </ActionButton>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4 border-t border-line pt-3">
          <p className="text-sm">
            <span className="text-xs text-muted">あなたの最初の判断: </span>
            <b>{LABEL[j.initialChoice]}</b>
          </p>

          <section className="space-y-2">
            <h3 className="font-bold">② AIの意見</h3>
            <div className="rounded-lg bg-surface-2 p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-muted">担当AI（{j.primaryModel}）</span>
                <b>{LABEL[j.primaryDecision]}</b>
                {a.decision && <span className="num text-xs text-muted">自信度 {Math.round(a.decision.confidence * 100)}%</span>}
                {j.primaryDecision === j.initialChoice && <span className="text-xs" style={{ color: "var(--good)" }}>✓ あなたと同じ</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-ink-2">{a.reason}</p>
              {a.decision && <p className="mt-1 text-ink-2"><span className="text-xs text-muted">次にやること: </span>{a.decision.nextAction}</p>}
            </div>
            {j.others.map((o) => (
              <div key={o.modelId} className="rounded-lg border border-line p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${o.provider})` }} />
                  <span className="text-xs text-muted">{o.label}</span>
                  {o.error ? <span style={{ color: "var(--critical)" }}>失敗</span> : <b>{LABEL[o.decision ?? ""] ?? "—"}</b>}
                  {o.confidence !== null && <span className="num text-xs text-muted">自信度 {Math.round(o.confidence * 100)}%</span>}
                  {o.decision === j.initialChoice && <span className="text-xs" style={{ color: "var(--good)" }}>✓ あなたと同じ</span>}
                </div>
                {o.reason && <p className="mt-1 text-ink-2">{o.reason}</p>}
              </div>
            ))}
            {j.othersPending && <p className="text-sm text-ink-2" role="status"><span aria-hidden className="mr-1 inline-block animate-spin">◐</span>他のAIの意見を集めています…</p>}
          </section>

          {j.debate && j.debate.status !== "agreed" && (
            <section className="space-y-2">
              <h3 className="font-bold">③ AI同士の議論（意見が割れたため）</h3>
              {j.debate.status === "running" && (
                <p className="text-sm text-ink-2" role="status"><span aria-hidden className="mr-1 inline-block animate-spin">◐</span>AIが互いの意見に反論しています…（30秒〜1分ほど）</p>
              )}
              {j.debate.status === "error" && <p className="text-sm" style={{ color: "var(--critical)" }}>議論の途中でエラーが起きました。AIの意見を見て判断してください。</p>}
              {j.debate.status === "done" && (
                <div className="space-y-2 text-sm">
                  <p><span className="text-xs text-muted">論点: </span>{j.debate.issue}</p>
                  {j.debate.positions?.map((p) => (
                    <div key={p.label} className="rounded-lg border border-line p-3">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${p.provider})` }} />
                        <span className="text-xs text-muted">{p.label}</span>
                        <b>{SHORT[p.first]}{p.changed ? ` → ${SHORT[p.final]}` : ""}</b>
                        {p.changed
                          ? <span className="text-xs" style={{ color: "var(--warning)" }}>▲ 議論で意見を変えた</span>
                          : <span className="text-xs text-muted">意見を維持</span>}
                      </div>
                      <p className="mt-1 text-ink-2">{p.argument}</p>
                    </div>
                  ))}
                  <p><span className="text-xs text-muted">判断をはっきりさせるのに足りない情報: </span>{j.debate.missingInfo}</p>
                  <p className="text-xs text-muted">論点と足りない情報は担当AIがまとめています。各AIの主張は本人（各AI）の言葉のままです。</p>
                </div>
              )}
            </section>
          )}
          {j.debate?.status === "agreed" && <p className="text-sm text-ink-2">AIの判断は一致したため、議論は行っていません。</p>}

          <section className="space-y-2 border-t border-line pt-3">
            <h3 className="font-bold">最終判断</h3>
            <p className="text-xs text-muted">最初の判断のままでも、変えてもかまいません。確定すると実行されます（改善ならAIがLPを作り直し、続ける・撤退ならAIが教訓をメモします）。</p>
            <div className="flex flex-wrap gap-2">
              {CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={final === c}
                  onClick={() => setFinal(c)}
                  className={`rounded-full border px-3 py-1 text-sm ${final === c ? "border-accent bg-accent text-accent-ink" : "border-line hover:bg-surface-2"}`}
                >
                  {LABEL[c]}
                </button>
              ))}
            </div>
            {final === "improve" && (
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="改善の指示（空欄なら、改善を提案したAIの案を使います）"
                className="w-full rounded-lg border border-line bg-surface p-2 text-sm"
              />
            )}
            <ActionButton
              variant="primary"
              disabled={!!busy || !final}
              onClick={() => run(final === "improve" ? "AIがLPを作り直しています…" : "処理しています…", { action: "final", approvalId: a.id, choice: final, comment: comment || undefined })}
            >
              「{SHORT[final] ?? "—"}」で確定する
            </ActionButton>
          </section>
        </div>
      )}
      <BusyNote busy={busy} error={error} />
    </article>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}
