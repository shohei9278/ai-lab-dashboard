import { ideaAuthorStats } from "@/lib/loop";
import { modelInfo } from "@/lib/models";
import { pct } from "@/lib/format";

const pt = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)}点`);

// アイデア出しの比較: 3社が出したアイデアを、作者を伏せて3社で採点した結果と、その後の実績
export function IdeaAuthors() {
  const stats = ideaAuthorStats();
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-bold">アイデア出しの比較</h2>
        <p className="text-sm text-ink-2">
          毎日の自動実行では、3社のAIがそれぞれアイデアを出し、作者を伏せて3社全員で採点し、平均点の上位を進めます。
          LPは3社の候補から作者を伏せた採点で選び、ツールや判断は同じAIが行うので、アイデアの作者とは関係なく決まります。結果の差は「アイデアの差」として比べられます。
        </p>
      </div>
      {stats.length === 0 ? (
        <div className="card p-6 text-sm text-ink-2">まだ記録がありません。毎日の自動実行が動くと、ここに溜まっていきます。</div>
      ) : (
        <>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr className="border-b border-line">
                  <th className="px-3 py-2">アイデアを出したAI</th>
                  <th className="px-3 py-2 text-right">選ばれた / 候補</th>
                  <th className="px-3 py-2 text-right">他社からの点</th>
                  <th className="px-3 py-2 text-right">自分の案への点</th>
                  <th className="px-3 py-2 text-right">他社の案への点</th>
                  <th className="px-3 py-2 text-right">人の採用</th>
                  <th className="px-3 py-2 text-right">実際の成果の率</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((s) => {
                  const m = modelInfo(s.author);
                  // 自分の案に、他社の案より1点以上高く付けていたら身内びいきの疑い
                  const selfBias = s.scoreFromSelf !== null && s.scoreGivenToOthers !== null && s.scoreFromSelf - s.scoreGivenToOthers >= 1;
                  return (
                    <tr key={s.author} className="num border-b border-line last:border-0">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />
                        {m.label}
                      </td>
                      <td className="px-3 py-2 text-right">{s.selected} / {s.candidates}</td>
                      <td className="px-3 py-2 text-right">{pt(s.scoreFromOthers)}</td>
                      <td className="px-3 py-2 text-right">
                        {pt(s.scoreFromSelf)}
                        {selfBias && <span className="ml-1 text-xs" style={{ color: "var(--warning)" }} title="自分の案に、他社の案より1点以上高い点を付けています">▲ 甘め</span>}
                      </td>
                      <td className="px-3 py-2 text-right">{pt(s.scoreGivenToOthers)}</td>
                      <td className="px-3 py-2 text-right">{s.humanDecided ? `${s.humanApproved} / ${s.humanDecided}` : "—"}</td>
                      <td className="px-3 py-2 text-right">{s.rate === null ? "—" : `${pct(s.rate, 1)}（${s.projectsWithTraffic}件）`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            「自分の案への点」と「他社の案への点」は、そのAIが審査員として付けた点です。自分の案だけ点が高ければ、作者を伏せていても文体などで見抜いて、ひいきしている可能性があります。
            「人の採用」は毎回承認モードでアイデアを承認した数です。「実際の成果の率」は、集客まで進んだ案件の合計です（事前登録LPは登録、ツールは利用の割合）。件数が少ないうちは差が偶然の可能性が高いです。
          </p>
        </>
      )}
    </section>
  );
}
