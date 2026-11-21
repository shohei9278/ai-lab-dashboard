import { PageIntro } from "@/components/PageIntro";
import { GrowthTabs } from "@/components/LabTabs";
import { PostStatsView } from "../../plan/PlanView";
import { AIMS } from "@/lib/aims";
import { followerHistory, hitGroups, hitRows, scoreChecks, type HitRow } from "@/lib/hits";
import { MODELS } from "@/lib/models";

export const dynamic = "force-dynamic";

// 効いた手: これまでのAIの投稿を、場所・時間帯・切り口の型ごとにまとめたもの
export default function GrowthStatsPage() {
  return (
    <div className="space-y-6">
      <PageIntro title="集客">
        これまでのAIの投稿を、場所・時間帯・切り口の型ごとにまとめたものです。毎朝の朝会で、担当のAIがこれを見て、訪問や反応が多い手を多めに使い、まだ試していない手も少し混ぜます。
        反応は「いいね＋返信＋リポスト」で、投稿の翌日と3日後に取り込みます（X は翌日の1回だけ。1件 約0.75円）。件数が少ないうちは、偶然の差が大きいです。
      </PageIntro>
      <GrowthTabs current="/growth/stats" />
      <section className="card p-4">
        <PostStatsView />
      </section>
      <HitsView />
      <ScoreCheckView />
    </div>
  );
}

// 当たりの記録: ねらい・ジャンルごとの成績と、X のフォロワー数の動き（次のアイデア出しにも、同じまとめを渡している）
function HitsView() {
  const rows = hitRows();
  const groups = hitGroups(rows);
  const followers = followerHistory(14);
  const first = followers[0]?.followers;
  const last = followers.at(-1)?.followers;
  const mark = (h: boolean | null) => (h === null ? "—" : h ? "当たり" : "当たらず");
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-bold">当たりの記録</h2>
        <p className="text-xs text-muted">
          ねらい・ジャンルごとに、遊んだ・使った人、シェア、当たり（「広がる」は公開から3日の判定、ほかは「続ける」で育てる段階に入ったか）と、公開から3日のフォロワーの増えをまとめています（公開から90日）。同じまとめを、次のアイデア出しにも渡しています。フォロワーの増えは、ほかの案件の公開と重なることもあるので、だいたいの数です。
        </p>
      </div>
      <div>
        <h3 className="text-sm font-bold">X のフォロワー数（直近14日）</h3>
        {followers.length === 0 ? (
          <p className="text-sm text-ink-2">まだ記録がありません（1日1回、X から読んで記録します）。</p>
        ) : (
          <>
            <p className="text-sm"><span className="num font-bold">{last}</span>人{followers.length > 1 && first !== undefined && last !== undefined ? <span className="text-ink-2">（{followers[0].day} から <span className="num">{last - first >= 0 ? "+" : ""}{last - first}</span>人）</span> : null}</p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-2">
              {followers.map((f) => <span key={f.day} className="num">{f.day.slice(5)} {f.followers}</span>)}
            </div>
          </>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold">ねらい・ジャンルごと</h3>
        {groups.length === 0 ? (
          <p className="text-sm text-ink-2">まだありません（ねらいの付いた案件を公開すると、ここにたまります）。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1 pr-3">ねらい・ジャンル</th><th className="py-1 pr-3 text-right">件数</th><th className="py-1 pr-3 text-right">当たり</th><th className="py-1 pr-3 text-right">遊んだ・使った</th><th className="py-1 pr-3 text-right">シェア</th><th className="py-1 text-right">フォロワーの増え</th></tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={`${g.aim}-${g.genre}`} className="border-t border-line">
                    <td className="py-1 pr-3">{AIMS[g.aim].label}・{g.genre}</td>
                    <td className="num py-1 pr-3 text-right">{g.count}</td>
                    <td className="num py-1 pr-3 text-right">{g.hits}/{g.judged}</td>
                    <td className="num py-1 pr-3 text-right">{g.plays}</td>
                    <td className="num py-1 pr-3 text-right">{g.shares}</td>
                    <td className="num py-1 text-right">{g.gain === null ? "—" : `${g.gain >= 0 ? "+" : ""}${g.gain}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">案件ごと（{rows.length}件）</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {rows.map((r) => (
              <li key={r.id}>
                <a href={`/projects/${r.id}`} className="text-accent underline">{r.title}</a>
                <span className="text-ink-2">（{AIMS[r.aim].label}{r.genre ? `・${r.genre}` : ""}・{r.publishedDay} 公開）遊んだ・使った {r.plays}人・シェア {r.shares}件・{mark(r.hit)}{r.followersGain === null ? "" : `・フォロワー ${r.followersGain >= 0 ? "+" : ""}${r.followersGain}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// 採点の答え合わせ: アイデア会議で各社のAIが付けた点と、当たったか。推し枠と平均で選んだ案の、当たりの数
function ScoreCheckView({ rows }: { rows?: HitRow[] }) {
  const { scorers, picks } = scoreChecks(rows);
  const label = (id: string) => MODELS.find((m) => m.id === id)?.label ?? id;
  const pt = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)}点`);
  const PICK_LABEL = { average: "平均点で選んだ案", champion: "推し枠で選んだ案" } as const;
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-bold">採点の答え合わせ</h2>
        <p className="text-xs text-muted">
          アイデア会議で各社のAIが付けた点と、その案件が当たったかを並べています。当たった案に高く、当たらなかった案に低く付けているAIほど、当たりを見分けられています。作者が自分の案に付けた点は数えません。当たったかが分かった案件（上の「当たりの記録」と同じ判定）だけを使います。件数が少ないうちは、偶然の差が大きいです。
        </p>
      </div>
      <div>
        <h3 className="text-sm font-bold">AIごと</h3>
        {scorers.length === 0 ? (
          <p className="text-sm text-ink-2">まだありません（案件の当たりが分かると、ここにたまります）。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-1 pr-3 font-normal">AI</th><th className="py-1 pr-3 text-right font-normal">当たった案に付けた点</th><th className="py-1 pr-3 text-right font-normal">当たらなかった案に付けた点</th><th className="py-1 text-right font-normal">差</th></tr>
              </thead>
              <tbody>
                {scorers.map((x) => (
                  <tr key={x.model} className="border-t border-line">
                    <td className="py-1 pr-3">{label(x.model)}</td>
                    <td className="num py-1 pr-3 text-right">{pt(x.hitAvg)}<span className="ml-1 text-xs text-muted">{x.hitN}件</span></td>
                    <td className="num py-1 pr-3 text-right">{pt(x.missAvg)}<span className="ml-1 text-xs text-muted">{x.missN}件</span></td>
                    <td className="num py-1 text-right">{x.hitAvg !== null && x.missAvg !== null ? `${x.hitAvg - x.missAvg >= 0 ? "+" : ""}${(x.hitAvg - x.missAvg).toFixed(1)}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <h3 className="text-sm font-bold">推し枠と平均点</h3>
        <p className="text-xs text-muted">毎日のアイデア出しで2件以上作る日は、最後の1件を、平均では漏れた案のうち、作者ではない会社のAIが8点以上を付けた案から選びます（推し枠）。全員がそこそこ良いと思う案だけでなく、尖った案も試すためです。</p>
        <ul className="mt-2 space-y-1 text-sm">
          {picks.map((p) => (
            <li key={p.kind} className="num flex justify-between gap-2">
              <span>{PICK_LABEL[p.kind]}</span>
              <span>{p.count}件・当たり {p.hits}/{p.judged}{p.judged ? `（${Math.round((p.hits / p.judged) * 100)}%）` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
