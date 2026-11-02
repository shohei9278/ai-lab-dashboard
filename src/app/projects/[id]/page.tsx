import Link from "next/link";
import { notFound } from "next/navigation";
import { db, getSettings, type EventRow } from "@/lib/db";
import { modelInfo } from "@/lib/models";
import { CONV, KIND_LABEL, MODE_LABEL, STAGE_LABEL, getProject, lpCandidates, lpVersions, projectTotals, targetRate, type Lp, type Review } from "@/lib/loop";
import { LpCandidates } from "@/components/LpCandidates";
import { THEMES } from "../../../../lp-site/src/lp/content";
import { maskEvents, pendingApprovals } from "@/lib/views";
import { pct, yen } from "@/lib/format";
import { ApprovalCard } from "@/components/ApprovalCard";
import { Stat } from "@/components/ui";
import { ProjectActions } from "./ProjectActions";
import { publicUrl } from "@/lib/publish";
import { ShadowJudgments } from "@/components/ShadowJudgments";

export const dynamic = "force-dynamic";

const STEPS = ["idea", "lp", "live", "deciding"] as const;
const ACTOR = { ai: "AI", human: "あなた", system: "システム" } as const;

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = getProject(Number(id));
  if (!p) notFound();
  const s = getSettings();
  const t = projectTotals(p.id);
  const approvals = pendingApprovals(p.id);
  const events = maskEvents(db().prepare("SELECT * FROM events WHERE project_id = ? ORDER BY id DESC").all(p.id) as EventRow[]);
  const aiCost = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s, COUNT(*) AS n FROM ai_calls WHERE project_id = ?").get(p.id) as { s: number; n: number });
  const lp = p.lp ? (JSON.parse(p.lp) as Lp) : null;
  const ended = ["continued", "killed", "rejected"].includes(p.stage);
  const stepIndex = ended ? STEPS.length : STEPS.indexOf(p.stage as (typeof STEPS)[number]);
  const adRatio = s.adBudgetPerProjectJpy ? t.adSpendJpy / s.adBudgetPerProjectJpy : 0;
  const versions = lpVersions(p.id);
  const conv = CONV[p.kind];
  const target = targetRate(p.kind, s);
  const isTool = p.kind === "tool";
  const shares = t.rows.reduce((n, r) => n + (r.shares ?? 0), 0);
  // 3社が作ったLPの候補（今の版のもの）。公開の判断が済むまでは作者を伏せる
  const publishPending = approvals.some((a) => a.kind === "publish");
  const cands = lpCandidates(p.id).filter((c) => c.version === p.lp_version);
  // 今のLP: 人が切り替えた候補があればそれ、なければAIが選んだ候補
  const humanPicked = cands.some((c) => c.human_selected);
  const candidateViews = cands.map((c) => {
    const clp = JSON.parse(c.lp) as Lp;
    const info = modelInfo(c.author_model);
    const hide = publishPending && !p.demo;
    return {
      id: c.id, label: c.label, avg: c.avg_score, headline: clp.headline,
      author: hide ? null : info.label, provider: hide ? null : info.provider,
      theme: clp.design ? THEMES[clp.design.theme]?.label ?? null : null,
      selected: !!c.selected, humanSelected: !!c.human_selected,
      current: humanPicked ? !!c.human_selected : !!c.selected,
    };
  });
  // 作者で判断が引っ張られないよう、人が一度も承認・却下していない案件ではアイデアの作者を伏せる
  const authorHidden = !p.demo && !db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND status != 'pending'").get(p.id);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link href="/" className="text-sm text-accent underline">← ホーム</Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-bold">{p.title}</h1>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs">{STAGE_LABEL[p.stage]}</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">{KIND_LABEL[p.kind]}</span>
          <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">{MODE_LABEL[p.mode]}モード</span>
          {p.origin === "daily" && <span className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">毎日の自動実行で作成</span>}
          {p.demo ? <span className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-ink-2">デモ</span> : null}
        </div>
        <p className="text-sm text-ink-2">このページでは、AIがこの案件で何を考え、何をして、どんな結果になったかが分かります。</p>
        <ol className="flex flex-wrap gap-1 text-xs" aria-label="進み具合">
          {[...STEPS.map((st) => STAGE_LABEL[st]), "結果"].map((label, i) => (
            <li key={label} className={`rounded-full px-2 py-0.5 ${i <= stepIndex ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`}>
              {i + 1}. {label}
            </li>
          ))}
        </ol>
      </div>

      {approvals.map((a) => <ApprovalCard key={a.id} a={a} />)}

      <ProjectActions id={p.id} convNoun={conv.noun} stage={p.stage} hasLp={!!lp} hasPending={approvals.length > 0} judgeMinVisits={s.judgeMinVisits} publicUrl={p.public_slug ? publicUrl(p.id) ?? `(URL未設定)/${p.public_slug}` : null} />

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">AIのアイデア</h2>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Item label="誰向け">{p.target}</Item>
          <Item label="困りごと">{p.problem}</Item>
          <Item label="解決策">{p.solution}</Item>
          <Item label="検証する仮説">{p.hypothesis}</Item>
          <Item label="AIがこれを選んだ理由">{p.ai_reason}</Item>
          <Item label="AIの自信度">{p.ai_confidence === null ? "—" : `${Math.round(p.ai_confidence * 100)}%`}</Item>
        </dl>
        <p className="text-xs text-muted">
          アイデアを考えたAI: {authorHidden ? "（あなたが最初の承認をするまで伏せています）" : modelInfo(p.idea_model ?? p.model_id).label}
          ・LPなどを作るAI: {modelInfo(p.model_id).label}
          {p.theme ? `・テーマ「${p.theme}」` : ""}・この案件のAI費用 {yen(aiCost.s, s.usdJpy)}（{aiCost.n}回）
        </p>
      </section>

      {lp && (
        <section className="card space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold">{isTool ? "AIが作ったツール" : "AIが作ったLP"}（今は第{p.lp_version}版）</h2>
            <Link href={`/lp/${p.id}`} target="_blank" className="text-sm text-accent underline">{isTool ? "ツールを開いて試す ↗" : "LPを開く ↗"}</Link>
          </div>
          <div className="text-lg font-bold">{lp.headline}</div>
          <div className="text-sm text-ink-2">{lp.subheadline}</div>
          {candidateViews.length > 1 && (
            <LpCandidates projectId={p.id} version={p.lp_version} items={candidateViews} canSwitch={publishPending && p.stage === "lp"} />
          )}
          {versions.length > 1 && (
            <div className="space-y-2 border-t border-line pt-3">
              <div className="text-xs text-muted">版の履歴（何をどう変えたか。自動モードではAIが承認なしで改善した版もあります）</div>
              <ol className="space-y-2 text-sm">
                {versions.map((v) => {
                  const vlp = JSON.parse(v.lp) as Lp;
                  const review = v.review ? (JSON.parse(v.review) as Review) : null;
                  const vt = projectTotals(p.id, v.version);
                  return (
                    <li key={v.id} className="rounded-lg bg-surface-2 p-2">
                      <div className="flex flex-wrap gap-x-3 text-xs text-ink-2">
                        <span className="font-medium text-ink">第{v.version}版</span>
                        <span className="num">{v.created_at.slice(5, 16)}</span>
                        <span>{v.note}</span>
                        {vt.visits > 0 && <span className="num">訪問 {vt.visits} / {conv.noun} {vt.signups}（{pct(vt.rate, 1)}）</span>}
                        {review && (review.ok
                          ? <span style={{ color: "var(--good)" }}>✓ チェックOK</span>
                          : <span style={{ color: "var(--critical)" }}>! {review.issues.join(" / ")}</span>)}
                      </div>
                      <div>{vlp.headline}</div>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </section>
      )}

      {t.rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">集客の結果{t.simulated && <span className="ml-2 text-xs font-normal text-muted">シミュレーションを含む</span>}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="訪問" value={`${t.visits}人`} sub={`判断の目安 ${s.judgeMinVisits}人`} />
            <Stat label={isTool ? "使った人" : "事前登録"} value={`${t.signups}人`} sub={isTool ? `シェア ${shares}人` : undefined} />
            <Stat
              label={conv.rate}
              value={<span style={{ color: t.rate >= target ? "var(--good)" : undefined }}>{pct(t.rate, 1)}</span>}
              sub={`目標 ${pct(target, 1)} ${t.rate >= target ? "✓ 達成" : "（未達）"}`}
            />
            <Stat label="広告費" value={`${t.adSpendJpy.toLocaleString("ja-JP")}円`} sub={`上限 ${s.adBudgetPerProjectJpy.toLocaleString("ja-JP")}円 の ${pct(adRatio)}`} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">日付</th>
                  <th className="px-3 py-2 text-right">訪問</th>
                  <th className="px-3 py-2 text-right">{conv.noun}</th>
                  <th className="px-3 py-2 text-right">{conv.rate}</th>
                  {isTool && <th className="px-3 py-2 text-right">シェア</th>}
                  <th className="px-3 py-2 text-right">広告費</th>
                  <th className="px-3 py-2">LPの版</th>
                  <th className="px-3 py-2">データ</th>
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r) => (
                  <tr key={r.id} className="num border-b border-line last:border-0">
                    <td className="px-3 py-2">{r.day}</td>
                    <td className="px-3 py-2 text-right">{r.visits}</td>
                    <td className="px-3 py-2 text-right">{r.signups}</td>
                    <td className="px-3 py-2 text-right">{r.visits ? pct(r.signups / r.visits, 1) : "—"}</td>
                    {isTool && <td className="px-3 py-2 text-right">{r.shares}</td>}
                    <td className="px-3 py-2 text-right">{r.ad_spend_jpy.toLocaleString("ja-JP")}円</td>
                    <td className="px-3 py-2 text-xs text-ink-2">第{r.lp_version}版</td>
                    <td className="px-3 py-2 text-xs text-ink-2">{r.source === "simulated" ? "シミュレーション" : r.source === "real" ? "実データ" : "手入力"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <ShadowJudgments projectId={p.id} hidePending />


      <section className="space-y-2">
        <h2 className="font-bold">経過</h2>
        <ol className="card divide-y divide-line text-sm">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 p-3">
              <span className="num shrink-0 text-xs text-muted">{e.at.slice(5, 16)}</span>
              <span className="w-14 shrink-0 text-xs font-medium" style={{ color: e.actor === "ai" ? "var(--accent)" : "var(--text-2)" }}>{ACTOR[e.actor]}</span>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
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
