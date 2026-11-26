import { durText, flowStats } from "@/lib/flowStats";

// AIの成績: 仕組みの詰まり。工程ごとに、直近7日に止まっていた時間の合計を見る（運営者が決めた。flowStats.ts）
// いま待っているものの題は、提案やAIの出力なので、運営者にだけ見せる
export function FlowCard({ owner }: { owner: boolean }) {
  const rows = flowStats();
  const max = Math.max(1, ...rows.map((r) => Math.max(r.hours, r.prevHours)));
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-bold">仕組みの詰まり</h2>
        <p className="text-xs text-muted">
          工程ごとに、直近7日に止まっていた時間の合計です。件数より、止まった時間の長さで、どこを直す価値が大きいかを見ます。月曜の定例会議の材料にも渡し、AIが詰まりを見つけて改善案を出します。急に増えたら知らせます。
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 font-normal">工程</th>
              <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">直近7日</th>
              <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">前の7日</th>
              <th className="whitespace-nowrap py-1 pl-2 text-right font-normal">いま待ち</th>
              <th className="hidden w-1/4 py-1 pl-3 font-normal sm:table-cell"><span className="sr-only">直近7日の棒</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.stage} className="border-t border-line align-top">
                <td className="py-1.5">
                  <div>{r.label}</div>
                  <div className="num text-xs text-muted">
                    入った{r.entered}件・終わった{r.finished}件{r.avgHours === null ? "" : `（平均${durText(r.avgHours)}）`}
                  </div>
                  {owner && r.oldest.length > 0 && (
                    <div className="mt-0.5 text-xs text-ink-2">長いもの: {r.oldest.map((o) => `「${o.title.slice(0, 30)}」${durText(o.hours)}`).join("・")}</div>
                  )}
                </td>
                <td className="num whitespace-nowrap py-1.5 pl-2 text-right font-medium">{durText(r.hours)}</td>
                <td className="num whitespace-nowrap py-1.5 pl-2 text-right text-ink-2">{durText(r.prevHours)}</td>
                <td className="num whitespace-nowrap py-1.5 pl-2 text-right">{r.waiting}件</td>
                <td className="hidden py-1.5 pl-3 sm:table-cell">
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2" title={`直近7日 ${durText(r.hours)}・前の7日 ${durText(r.prevHours)}`}>
                    <div className="h-full rounded-full" style={{ width: `${(r.hours / max) * 100}%`, background: "var(--warning)" }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
