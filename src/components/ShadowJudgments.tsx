import Link from "next/link";
import { debateStats, shadowRounds, shadowScores, type Decision } from "@/lib/loop";
import { modelInfo } from "@/lib/models";
import { pct } from "@/lib/format";

const SHORT: Record<Decision["decision"], string> = { continue: "続ける", improve: "改善", collect: "集客継続", kill: "撤退", rethink: "集客を見直す" };
const short = (d: string | null) => (d ? SHORT[d as Decision["decision"]] ?? d : "—");

// 判断の裏比較: AIごとの成績と、判断1回ごとの答えの並び
export function ShadowJudgments({ projectId, hidePending = false }: { projectId?: number; hidePending?: boolean }) {
  const all = shadowRounds();
  // 人がまだ最初の判断を選んでいない回は、どの画面でも出さない（先入観にならないように）
  // 案件画面では、最終判断を確定するまで出さない
  const rounds = all
    .filter((r) => (projectId ? r.project?.id === projectId : true))
    .filter((r) => r.primary.approval_id === null || r.initial !== null || r.human !== null)
    .filter((r) => !hidePending || r.human !== null || r.primary.approval_id === null);
  const models = [...new Set(all.flatMap((r) => r.rows.map((x) => x.model_id)))];

  if (projectId) {
    if (!rounds.length) return null;
    return (
      <section className="space-y-2">
        <h2 className="font-bold">他のAIの判断（参考）</h2>
        <p className="text-xs text-muted">同じ数字を他のAIにも見せて、どう判断したかを記録したものです。実際の流れには使っていません。</p>
        <RoundsTable rounds={rounds} models={models} showProject={false} />
      </section>
    );
  }

  const scores = shadowScores();
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-bold">判断の裏比較</h2>
        <p className="text-sm text-ink-2">
          製品ループでAIが「続ける・改善・集客継続・撤退」を判断するたびに、同じ数字を他社のAIにも見せて答えを記録しています。
          実際に使うのは担当AIの判断だけです。人の選択と一致するAIほど、判断を任せやすいと言えます。
        </p>
      </div>
      {scores.length === 0 ? (
        <div className="card p-6 text-sm text-ink-2">まだ記録がありません。案件でAIが判断すると、ここに溜まっていきます。</div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">AI</th>
                  <th className="px-3 py-2 text-right">判断した回数</th>
                  <th className="px-3 py-2 text-right">人の最初の判断と一致</th>
                  <th className="px-3 py-2 text-right">人の最終判断と一致</th>
                  <th className="px-3 py-2 text-right">担当AIと一致</th>
                  <th className="px-3 py-2 text-right">平均の自信度</th>
                  <th className="px-3 py-2 text-right">失敗</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((s) => {
                  const m = modelInfo(s.modelId);
                  return (
                    <tr key={s.modelId} className="num border-b border-line last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />
                        {m.label}
                        {s.wasPrimary > 0 && <span className="ml-2 text-xs text-muted">担当{s.wasPrimary}回</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{s.judged}</td>
                      <td className="px-3 py-2 text-right">{s.agreeInitial === null ? "—" : `${pct(s.agreeInitial)}（${s.agreeInitialN}回中）`}</td>
                      <td className="px-3 py-2 text-right">{s.agreeHuman === null ? "—" : `${pct(s.agreeHuman)}（${s.agreeHumanN}回中）`}</td>
                      <td className="px-3 py-2 text-right">{s.agreePrimary === null ? "—" : `${pct(s.agreePrimary)}（${s.agreePrimaryN}回中）`}</td>
                      <td className="px-3 py-2 text-right">{s.avgConfidence === null ? "—" : pct(s.avgConfidence)}</td>
                      <td className="px-3 py-2 text-right">{s.errors || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            「最初の判断」はAIの意見を見る前に人が選んだもの、「最終判断」はAIの意見と議論を見たあとに確定したものです。
            最初の判断との一致が、AIの判断力を素直に表します（最終判断はAIの意見に影響されているため）。自動で進んだ回（人が判断していない回）は含みません。
            回数が少ないうちは、一致率の差は偶然の可能性が高いです。
          </p>
          <DebateSummary />
          <RoundsTable rounds={rounds.slice(0, 20)} models={models} showProject />
        </>
      )}
    </section>
  );
}

// AI同士の議論が、人の判断を変えたか
function DebateSummary() {
  const d = debateStats();
  if (!d.decided) return null;
  return (
    <div className="card space-y-1 p-4 text-sm">
      <div className="font-bold">AI同士の議論は、人の判断を変えたか</div>
      <p className="num text-ink-2">
        2段階で判断した {d.decided}回のうち、AIの意見が割れて議論が起きたのは {d.debated}回。
        議論があった回で最初の判断を変えたのは {d.changedAfterDebate}回、議論がなかった回で変えたのは {d.changedWithoutDebate}回（{d.quiet}回中）です。
      </p>
      <p className="text-xs text-muted">変えた判断が正しかったかは、その案件の最終的な結果が出てから振り返ります。</p>
    </div>
  );
}

function RoundsTable({ rounds, models, showProject }: {
  rounds: ReturnType<typeof shadowRounds>; models: string[]; showProject: boolean;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr className="border-b border-line">
            <th className="px-3 py-2">日時</th>
            {showProject && <th className="px-3 py-2">案件</th>}
            {models.map((m) => <th key={m} className="px-3 py-2 whitespace-nowrap">{modelInfo(m).label}</th>)}
            <th className="px-3 py-2">人の選択</th>
          </tr>
        </thead>
        <tbody>
          {rounds.map((r) => (
            <tr key={r.primary.id} className="border-b border-line align-top last:border-0">
              <td className="num px-3 py-2 whitespace-nowrap text-ink-2">{r.at.slice(5, 16)}</td>
              {showProject && (
                <td className="px-3 py-2">
                  {r.project ? <Link href={`/projects/${r.project.id}`} className="text-accent underline">{r.project.title}</Link> : "—"}
                  <span className="ml-1 text-xs text-muted">第{r.lpVersion}版{r.project?.demo ? "・デモ" : ""}</span>
                </td>
              )}
              {models.map((m) => {
                const x = r.rows.find((y) => y.model_id === m);
                const matchHuman = r.human && x?.decision === r.human;
                return (
                  <td key={m} className="px-3 py-2 whitespace-nowrap" title={x?.reason ?? x?.error ?? ""}>
                    {x?.error ? <span style={{ color: "var(--critical)" }}>失敗</span> : short(x?.decision ?? null)}
                    {x?.is_primary ? <span className="ml-1 text-xs text-muted">担当</span> : null}
                    {matchHuman ? <span className="ml-1" style={{ color: "var(--good)" }} aria-label="人と一致">✓</span> : null}
                  </td>
                );
              })}
              <td className="px-3 py-2 whitespace-nowrap">
                {r.human
                  ? <>{r.initial && r.initial !== r.human ? `${short(r.initial)} → ` : ""}{short(r.human)}</>
                  : <span className="text-muted">{r.primary.approval_id ? "未判断" : "自動で進行"}</span>}
                {r.debated && <span className="ml-1 text-xs text-muted">議論あり</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

