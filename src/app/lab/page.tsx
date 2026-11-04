import Link from "next/link";
import { getSettings } from "@/lib/db";
import { getModel } from "@/lib/models";
import { KIND_LABEL, MODE_LABEL, activeLessons, modeComparison } from "@/lib/loop";
import { headline, kindComparison, overallRanking, rankings, type Ranking } from "@/lib/experiment";
import { pct, yen } from "@/lib/format";
import { PageIntro } from "@/components/PageIntro";
import { LabTabs } from "@/components/LabTabs";
import { Stat } from "@/components/ui";
import { ShadowJudgments } from "@/components/ShadowJudgments";
import { IdeaAuthors } from "@/components/IdeaAuthors";
import { DesignAuthors } from "@/components/DesignAuthors";
import { CostEfficiency } from "@/components/CostEfficiency";

export const dynamic = "force-dynamic";

const MEDAL = ["1位", "2位", "3位"];
const jpy = (x: number) => `${Math.round(x).toLocaleString("ja-JP")}円`;

// AIそのものの実験結果（プロダクトの管理ではなく、「AIに任せるとどうなるか」）
export default function LabPage() {
  const s = getSettings();
  const h = headline();
  const list = rankings();
  const overall = overallRanking(list);
  const kinds = kindComparison();
  const modes = modeComparison().filter((m) => m.projects > 0);
  const lessons = activeLessons();
  const badRate = h.auto.reviewed ? h.auto.bad / h.auto.reviewed : null;

  return (
    <div className="space-y-6">
      <PageIntro title="実験結果">
        「AIに任せると、どこまでプロダクトを作れるか」の結果です。プロダクトの管理はホームで、ここではAIの成績だけを見ます。
        いま製品ループを担当しているAIは <b>{getModel(s.loopModel).label}</b>、アイデアとLPの候補は3社のAIが競っています。
      </PageIntro>
      <LabTabs current="/lab" />

      {/* 大きな数字 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="AIが作った案件" value={`${h.projects}件`} sub={`公開 ${h.published}件・継続 ${h.continued}件・撤退 ${h.killed}件`} />
        <Stat
          label="AIだけで公開して、人が見てダメだった割合"
          value={badRate === null ? "—" : pct(badRate, 0)}
          sub={`AIだけで公開 ${h.auto.published}件・あなたが確認 ${h.auto.reviewed}件・ダメ ${h.auto.bad}件`}
        />
        <Stat label="訪問者のうち登録・利用した割合" value={h.rate === null ? "—" : pct(h.rate, 1)} sub={`訪問 ${h.visits}人・登録/利用 ${h.conversions}人・Xへの投稿 ${h.posts}件`} />
        <Stat
          label="成果1件あたりのAI費用"
          value={h.perConversionJpy === null ? "—" : jpy(h.perConversionJpy)}
          sub={`AI費用の累計 ${jpy(h.aiJpy)}（${h.aiCalls.toLocaleString("ja-JP")}回）`}
        />
      </div>

      {/* 総合ランキング */}
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">総合ランキング</h2>
          <p className="text-xs text-muted">下の部門別ランキングで、1位を取った数の順です（同じなら2位の数）。比べる相手がいない部門は数えません。</p>
        </div>
        {overall.length === 0 ? (
          <p className="text-sm text-ink-2">まだ比べられるデータがありません。毎日の自動実行で3社がアイデアやLPを出すと、順位が付き始めます。</p>
        ) : (
          <>
          <ol className="grid gap-2 sm:grid-cols-3">
            {overall.slice(0, 3).map((o, i) => (
              <li key={o.modelId} className="rounded-xl border border-line p-3" style={i === 0 && o.first > 0 ? { borderColor: "var(--accent)" } : undefined}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold">{i + 1}位</span>
                  <span className="num text-xs text-muted">{o.entered}部門に参加</span>
                </div>
                <div className="mt-1 flex items-center gap-2 font-medium">
                  <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: `var(--series-${o.provider})` }} />
                  {o.label}
                </div>
                <div className="num mt-1 text-2xl font-bold">{o.first}<span className="ml-1 text-xs font-normal text-ink-2">部門で1位</span></div>
                <div className="num text-xs text-ink-2">2位 {o.second}部門</div>
              </li>
            ))}
          </ol>
          {overall.length > 3 && (
            <p className="num text-xs text-ink-2">
              4位以下: {overall.slice(3).map((o, i) => `${i + 4}位 ${o.label}（1位 ${o.first}・${o.entered}部門）`).join("　")}
            </p>
          )}
          </>
        )}
      </section>

      {/* 部門別ランキング */}
      <section className="space-y-2">
        <div>
          <h2 className="font-bold">部門別ランキング</h2>
          <p className="text-xs text-muted">件数（n）が少ないうちは、順位の差は偶然の可能性が高いです。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((r) => <RankingCard key={r.key} r={r} />)}
        </div>
      </section>

      {/* 全自動の成績 */}
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">AIだけでどこまで進めたか</h2>
          <p className="text-xs text-muted">人の承認なしで進んだもの、AIが自分で止めて人に回したもの、人が手を動かした回数です。</p>
        </div>
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Num label="AIだけで公開" value={`${h.auto.published}件`} />
          <Num label="AIのチェックで止めて人に回した" value={`${h.blocked}回`} />
          <Num label="AIが承認なしで改善・継続・撤退" value={`${h.aiDecisions}回`} />
          <Num label="人が操作した回数（承認・修正・確認など）" value={`${h.humanActs}回`} />
        </div>
        {h.auto.reviewed > 0 && (
          <div>
            <div className="flex justify-between text-xs text-ink-2">
              <span>あなたが確認したもののうち「問題なし」</span>
              <span className="num">{h.auto.reviewed - h.auto.bad} / {h.auto.reviewed}件</span>
            </div>
            <Bar value={(h.auto.reviewed - h.auto.bad) / h.auto.reviewed} color="var(--good)" />
          </div>
        )}
      </section>

      {/* 出し方の比較 */}
      <section className="space-y-2">
        <h2 className="font-bold">出し方の比較（事前登録LP・動くツール）</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {kinds.map((k) => (
            <div key={k.kind} className="card space-y-2 p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{KIND_LABEL[k.kind]}</span>
                <span className="num text-xs text-muted">{k.projects}件（公開 {k.published}件）</span>
              </div>
              <div className="num text-2xl font-bold">{k.rate === null ? "—" : pct(k.rate, 1)}<span className="ml-1 text-xs font-normal text-ink-2">{k.kind === "tool" ? "利用率" : "登録率"}</span></div>
              <div className="num text-xs text-ink-2">
                訪問 {k.visits}人・成果 {k.conversions}人・1件あたり {k.perConversion === null ? "—" : jpy(k.perConversion)}・継続 {k.continued} / 撤退 {k.killed}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* モードの比較 */}
      {modes.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-bold">進め方（モード）の比較</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">モード</th>
                  <th className="px-3 py-2 text-right">案件数</th>
                  <th className="px-3 py-2 text-right">人の承認（1案件あたり）</th>
                  <th className="px-3 py-2 text-right">改善</th>
                  <th className="px-3 py-2 text-right">チェックで問題</th>
                  <th className="px-3 py-2 text-right">成果の率</th>
                  <th className="px-3 py-2 text-right">継続 / 撤退</th>
                  <th className="px-3 py-2 text-right">AI費用</th>
                </tr>
              </thead>
              <tbody>
                {modes.map((m) => (
                  <tr key={m.mode} className="num border-b border-line last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">{MODE_LABEL[m.mode]}</td>
                    <td className="px-3 py-2 text-right">{m.projects}</td>
                    <td className="px-3 py-2 text-right">{m.humanApprovals}回（{m.approvalsPerProject.toFixed(1)}）</td>
                    <td className="px-3 py-2 text-right">{m.improvements}回</td>
                    <td className="px-3 py-2 text-right">{m.reviewIssues}件</td>
                    <td className="px-3 py-2 text-right">{m.rate === null ? "—" : pct(m.rate, 1)}</td>
                    <td className="px-3 py-2 text-right">{m.continued} / {m.killed}</td>
                    <td className="px-3 py-2 text-right">{yen(m.costUsd, s.usdJpy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 教訓 */}
      <section className="space-y-2">
        <div>
          <h2 className="font-bold">AIの教訓（{lessons.length}件）</h2>
          <p className="text-xs text-muted">終わった案件からAIが学んだこと。次のアイデア出しで参照されます。</p>
        </div>
        <div className="card divide-y divide-line text-sm">
          {lessons.length ? lessons.map((l) => (
            <div key={l.id} className="p-3">
              {l.text}
              {l.project_id && <Link href={`/projects/${l.project_id}`} className="ml-2 text-xs text-accent underline">案件</Link>}
            </div>
          )) : <div className="p-3 text-ink-2">まだありません。案件が終わると、AIが教訓を書きます。</div>}
        </div>
      </section>

      {/* 詳しい表 */}
      <details className="card p-4">
        <summary className="cursor-pointer font-bold">詳しい表（ランキングの元になった数字）</summary>
        <div className="mt-4 space-y-6">
          <IdeaAuthors />
          <DesignAuthors />
          <ShadowJudgments />
          <CostEfficiency />
        </div>
      </details>
    </div>
  );
}

function RankingCard({ r }: { r: Ranking }) {
  const top = r.rows[0]?.value ?? 0;
  // 棒の長さ: 高いほど良い部門は値そのもの、低いほど良い部門は「1位の値 ÷ その値」
  const len = (v: number) => (r.better === "high" ? v / (r.max ?? (top || 1)) : v === 0 ? 1 : r.max ? 1 - v / r.max : top / v);
  return (
    <div className="card space-y-2 p-4">
      <div>
        <div className="font-medium">{r.title}</div>
        <p className="text-xs text-muted">{r.question}</p>
      </div>
      {r.rows.length === 0 ? (
        <p className="text-sm text-ink-2">{r.empty}</p>
      ) : (
        <ol className="space-y-2">
          {r.rows.map((row, i) => (
            <li key={row.modelId}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="num w-8 shrink-0 text-xs font-bold" style={{ color: i === 0 && r.rows.length > 1 ? "var(--accent)" : "var(--text-2)" }}>{MEDAL[i] ?? `${i + 1}位`}</span>
                  <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--series-${row.provider})` }} />
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="num shrink-0 font-medium">{row.display}<span className="ml-1 text-xs font-normal text-muted">n={row.n}</span></span>
              </div>
              <Bar value={len(row.value)} color={`var(--series-${row.provider})`} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  const v = Math.max(0.02, Math.min(1, value));
  return (
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}

function Num({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="num mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
