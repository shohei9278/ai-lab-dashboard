import { costEfficiency } from "@/lib/cost";
import { modelInfo } from "@/lib/models";
import { KIND_LABEL } from "@/lib/loop";

const yen = (x: number) => `${Math.round(x).toLocaleString("ja-JP")}円`;

// 成果1件あたりの費用: どの出し方・どのAIのアイデアが、安く成果を出せているか
export function CostEfficiency() {
  const c = costEfficiency();
  const rows = [
    ...c.byKind.map((g) => ({ ...g, label: KIND_LABEL[g.key as "lp" | "tool"], dot: null as string | null })),
    ...c.byIdeaAuthor.map((g) => ({ ...g, label: `${modelInfo(g.key).label} のアイデア`, dot: `var(--series-${modelInfo(g.key).provider})` })),
  ];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-bold">成果1件あたりの費用</h2>
        <p className="text-sm text-ink-2">
          AI費用（その案件のために呼んだAIの合計）と広告費を足して、成果（事前登録LPは登録、ツールは利用）の数で割ったものです。
          どの出し方・どのAIのアイデアが、安く成果を出せているかを比べます（実案件のみ）。
        </p>
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted">
            <tr className="border-b border-line">
              <th className="px-3 py-2">まとめ方</th>
              <th className="px-3 py-2 text-right">案件</th>
              <th className="px-3 py-2 text-right">AI費用</th>
              <th className="px-3 py-2 text-right">広告費</th>
              <th className="px-3 py-2 text-right">成果</th>
              <th className="px-3 py-2 text-right">1件あたり</th>
            </tr>
          </thead>
          <tbody>
            <tr className="num border-b border-line font-medium">
              <td className="px-3 py-2">全体</td>
              <td className="px-3 py-2 text-right">{c.all.projects}</td>
              <td className="px-3 py-2 text-right">{yen(c.all.aiJpy)}</td>
              <td className="px-3 py-2 text-right">{yen(c.all.adJpy)}</td>
              <td className="px-3 py-2 text-right">{c.all.conversions}件</td>
              <td className="px-3 py-2 text-right">{c.all.perConversion === null ? "—" : yen(c.all.perConversion)}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.label} className="num border-b border-line last:border-0">
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.dot && <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.dot }} />}
                  {r.label}
                </td>
                <td className="px-3 py-2 text-right">{r.projects}</td>
                <td className="px-3 py-2 text-right">{yen(r.aiJpy)}</td>
                <td className="px-3 py-2 text-right">{yen(r.adJpy)}</td>
                <td className="px-3 py-2 text-right">{r.conversions}件</td>
                <td className="px-3 py-2 text-right">{r.perConversion === null ? "—" : yen(r.perConversion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">成果が0件のときは「—」です。毎日のアイデア出しや採点のように、特定の案件に結びつかないAI費用は含みません。</p>
    </section>
  );
}
