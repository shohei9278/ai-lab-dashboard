import { apiWishSummary } from "@/lib/apiWishes";

// AIがアイデアに書いた「使いたい API」の集計（第2段の入口）。今は通信を止めたままで、どれを許すかを決める材料にする
export function ApiWishes() {
  const list = apiWishSummary(30);
  return (
    <div className="card space-y-3 p-4">
      <div>
        <h3 className="font-bold">AIが使いたがった API（直近30日）</h3>
        <p className="text-xs text-muted">
          アイデアに書かれた「使えたら明らかに良くなる API」を、名前ごとに数えています（選ばれなかった案も含む）。今は外への通信を止めたままで、どの API も使っていません。同じ API が何度も求められたら、許すかを決める材料にします。
        </p>
      </div>
      {list.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1 pr-3 font-normal">API</th>
                <th className="whitespace-nowrap py-1 pr-3 text-right font-normal">案</th>
                <th className="py-1 pr-3 font-normal">何に使うか（例）</th>
                <th className="whitespace-nowrap py-1 pr-3 font-normal">鍵</th>
                <th className="py-1 font-normal">送る情報（例）</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {list.map((w) => (
                <tr key={w.name}>
                  <td className="min-w-[7rem] py-1.5 pr-3 font-medium" title={w.titles.join(" / ")}>{w.name}</td>
                  <td className="num py-1.5 pr-3 text-right">{w.count}</td>
                  <td className="py-1.5 pr-3 text-xs text-ink-2">{w.purposes.join(" / ")}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs">{w.key ? "要る" : "不要"}</td>
                  <td className="py-1.5 text-xs text-ink-2">{w.sends.join(" / ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-ink-2">まだありません。</p>
      )}
    </div>
  );
}
