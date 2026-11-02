import { designAuthorStats } from "@/lib/loop";
import { modelInfo } from "@/lib/models";
import { pct } from "@/lib/format";

const pt = (x: number | null) => (x === null ? "—" : `${x.toFixed(1)}点`);

// LPのデザインの比較: 3社が作ったLPの候補を、作者を伏せて3社で採点した結果と、その後の実績
export function DesignAuthors() {
  const stats = designAuthorStats();
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-bold">LPのデザインの比較</h2>
        <p className="text-sm text-ink-2">
          事前登録LPの最初の版は、3社のAIがそれぞれ文章と見た目（テーマ色・配置・画面イメージ）を作り、作者を伏せて3社全員で採点して1位を使います。
          公開する前なら、あなたが別の候補に切り替えることもできます。
        </p>
      </div>
      {stats.length === 0 ? (
        <div className="card p-6 text-sm text-ink-2">まだ記録がありません（公開の判断が済んだ実案件だけを数えます）。</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">LPを作ったAI</th>
                <th className="px-3 py-2 text-right">候補 / AIが選択 / あなたが選択</th>
                <th className="px-3 py-2 text-right">他社からの点</th>
                <th className="px-3 py-2 text-right">自分の案への点</th>
                <th className="px-3 py-2 text-right">実際の登録率</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((r) => {
                const m = modelInfo(r.author);
                return (
                  <tr key={r.author} className="num border-b border-line last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--series-${m.provider})` }} />
                      {m.label}
                    </td>
                    <td className="px-3 py-2 text-right">{r.candidates} / {r.aiSelected} / {r.humanSelected}</td>
                    <td className="px-3 py-2 text-right">{pt(r.scoreFromOthers)}</td>
                    <td className="px-3 py-2 text-right">{pt(r.scoreFromSelf)}</td>
                    <td className="px-3 py-2 text-right">{r.rate === null ? "—" : `${pct(r.rate, 1)}（訪問${r.visits}）`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
