import { CHECK_EVAL_HISTORY, checkEvalModels, checkEvalOverview, estimateCheckEvalJpy, type CheckEvalSummary } from "@/lib/checkEval";
import { getSettings } from "@/lib/db";
import { getModel, modelInfo } from "@/lib/models";
import { jstDateTime } from "@/lib/format";
import { ShowMore } from "./ShowMore";
import { CheckEvalRun } from "./CheckEvalRun";
import { CheckEvalSeeds, type SeedView } from "./CheckEvalSeeds";
import { evalSeeds } from "@/lib/evalSeeds";
import { CHECK_EVAL_TYPE_LABEL } from "@/lib/checkEvalCases";

// 試験問題の候補を画面の形にする（運営者だけ。ページの下書きとAIの入出力が入るので、来訪者には渡さない）
function seedViews(): SeedView[] {
  return evalSeeds("candidate").map((s) => {
    const lp = JSON.parse(s.lp) as { headline?: string };
    return {
      id: s.id,
      title: s.title,
      version: s.lp_version,
      happened: s.ai_ok ? `チェックは通した → あなたが${s.human_action === "reject" ? "却下した" : "作り直しを指示した"}（見逃しかも）` : "チェックは止めた → あなたが公開した（止めすぎかも）",
      headline: lp.headline ?? "",
      aiIssues: JSON.parse(s.ai_issues) as string[],
      humanComment: s.human_comment,
      suggest: s.suggest_expect && s.suggest_reason && s.suggest_score
        ? { expect: s.suggest_expect, type: s.suggest_type, typeLabel: s.suggest_type ? CHECK_EVAL_TYPE_LABEL[s.suggest_type] : null, score: s.suggest_score, reason: s.suggest_reason, model: s.suggest_model ? modelInfo(s.suggest_model).label : "" }
        : null,
      suggestError: s.suggest_error,
    };
  });
}

const rate = (n: number, d: number) => (d ? n / d : 0);

function Meter({ label, n, d, color }: { label: string; n: number; d: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between gap-2 text-xs text-ink-2">
        <span>{label}</span>
        <span className="num shrink-0">{n} / {d}件</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, rate(n, d) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Result({ s, owner, stale }: { s: CheckEvalSummary; owner: boolean; stale: boolean }) {
  return (
    <div className="space-y-3 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-medium">{modelInfo(s.run.model_id).label}</div>
        <div className="text-xs text-muted">{jstDateTime(s.run.at)}{stale ? "・このあとチェックの指示か例を変えています" : ""}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="text-xs text-ink-2">問題のあるページを止めた</div>
          <div className="num mt-1 text-xl font-bold">{s.ng.caught} / {s.ng.total}件</div>
          <div className="text-xs" style={{ color: s.ng.missed ? "var(--critical)" : "var(--good)" }}>{s.ng.missed ? `見逃し ${s.ng.missed}件` : "見逃しなし"}</div>
        </div>
        <div className="rounded-lg bg-surface-2 p-3">
          <div className="text-xs text-ink-2">問題のないページを通した</div>
          <div className="num mt-1 text-xl font-bold">{s.ok.passed} / {s.ok.total}件</div>
          <div className="text-xs" style={{ color: s.ok.blocked ? "var(--warning)" : "var(--good)" }}>{s.ok.blocked ? `止めすぎ ${s.ok.blocked}件` : "止めすぎなし"}</div>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-xs text-muted">問題の種類ごとに、止められた数</div>
        {s.byType.map((t) => (
          <Meter key={t.type} label={t.label} n={t.caught} d={t.total} color={t.caught === t.total ? "var(--good)" : "var(--warning)"} />
        ))}
      </div>
      {s.failed > 0 && <p className="text-xs text-muted">答えが取れなかった例が{s.failed}件あり、数に入れていません。</p>}
      {owner && (s.misses.length > 0 || s.overblocks.length > 0 || s.failures.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-accent">見逃した例・止めすぎた例{s.failures.length > 0 ? "・答えが取れなかった例" : ""}を見る</summary>
          <ul className="mt-2 space-y-1.5 text-xs">
            {s.misses.map((m) => <li key={m.caseId}><span style={{ color: "var(--critical)" }}>見逃し</span>　{m.note}<span className="text-muted">（{m.caseId}）</span></li>)}
            {s.overblocks.map((o) => (
              <li key={o.caseId}>
                <span style={{ color: "var(--warning)" }}>止めすぎ</span>　{o.note}<span className="text-muted">（{o.caseId}）</span>
                {o.issues.length > 0 && <div className="mt-0.5 text-ink-2">チェックの指摘: {o.issues.join(" / ")}</div>}
              </li>
            ))}
            {s.failures.map((f) => (
              <li key={f.caseId}>
                <span className="text-muted">答えが取れなかった</span>　{f.note}<span className="text-muted">（{f.caseId}）</span>
                <div className="mt-0.5 break-words text-ink-2">理由: {f.error}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// AIの成績: 公開前チェックのテスト。AIだけで公開するときの最後の関門が、問題のあるページを見逃さないかを、正解の決まった例で確かめる
export function CheckEvalCard({ owner }: { owner: boolean }) {
  const o = checkEvalOverview();
  const s = getSettings();
  const models = owner ? checkEvalModels().map((id) => ({ id, label: getModel(id).label, estimate: estimateCheckEvalJpy(id) })) : [];
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">公開前チェックのテスト</h2>
        <p className="text-xs text-muted">
          AIだけで公開するとき、最後に止める役は公開前チェック（いまは {getModel(s.loopModel).label}）です。それが問題のあるページを見逃さないかを、正解の決まった{o.cases.total}件の例で確かめています。
          例は実際に作ったページをもとにしていて、問題のないもの{o.cases.ok}件と、問題のあるもの{o.cases.ng}件です{o.cases.fromProduction > 0 ? `（うち${o.cases.fromProduction}件は、本番で運営者がチェックの結果を覆したページから入れたもの）` : ""}。チェックには本番と同じ指示を使います。
          運営者がチェックの結果を覆すと、そのページが試験問題の候補になり、運営者が正解を決めたものから試験に加わります。
        </p>
      </div>
      {o.running && <p className="text-sm text-ink-2">{modelInfo(o.running.run.model_id).label} で評価しています（{o.running.done} / {o.cases.total}件）…</p>}
      {o.latest.length ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {o.latest.map((x) => <Result key={x.run.id} s={x} owner={owner} stale={x.run.prompt_hash !== o.promptHash} />)}
        </div>
      ) : (
        !o.running && <p className="text-sm text-ink-2">まだ評価していません。</p>
      )}
      {o.history.length > 1 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-accent">これまでの評価（直近{o.history.length}回{o.history.length >= CHECK_EVAL_HISTORY ? "まで" : ""}）</summary>
          <ShowMore initial={5} className="mt-2 space-y-1 text-xs">
            {o.history.map((h) => (
              <div key={h.run.id} className="flex flex-wrap gap-x-3 text-ink-2">
                <span className="num">{jstDateTime(h.run.at)}</span>
                <span>{modelInfo(h.run.model_id).label}</span>
                {h.run.status === "error" ? <span style={{ color: "var(--critical)" }}>{h.run.error ?? "途中で止まった"}</span> : <>
                  <span className="num">止めた {h.ng.caught}/{h.ng.total}</span>
                  <span className="num">通した {h.ok.passed}/{h.ok.total}</span>
                </>}
                {owner && h.run.cost_usd != null && <span className="num">約{Math.round(h.run.cost_usd * s.usdJpy)}円</span>}
                <span className="text-muted">指示と例 {h.run.prompt_hash}{h.run.prompt_hash !== o.promptHash ? "（今の指示と例に変える前）" : ""}</span>
              </div>
            ))}
          </ShowMore>
        </details>
      )}
      {owner && <CheckEvalSeeds seeds={seedViews()} types={Object.entries(CHECK_EVAL_TYPE_LABEL).map(([key, label]) => ({ key, label }))} />}
      {owner && <CheckEvalRun models={models} running={!!o.running} total={o.cases.total} />}
    </section>
  );
}
