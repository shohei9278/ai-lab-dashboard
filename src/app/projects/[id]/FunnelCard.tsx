import type { Funnel } from "@/lib/funnel";

const pc = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

// ページの中での動き: 訪問した人が、どこまで進んだか
export function FunnelCard({ f, isTool }: { f: Funnel; isTool: boolean }) {
  // いちばん大きく減っている段（前の段からの割合が最も低いところ）
  let worst = -1;
  let worstRate = 1;
  f.steps.forEach((s, i) => {
    if (i === 0 || !f.steps[i - 1].visitors) return;
    const r = s.visitors / f.steps[i - 1].visitors;
    if (r < worstRate) { worstRate = r; worst = i; }
  });
  return (
    <section className="card space-y-4 p-4">
      <div>
        <h2 className="font-bold">ページの中での動き（第{f.version}版）</h2>
        <p className="text-xs text-muted">
          訪問した人が、どこまで進んだかです。人数は訪問者ごと・1日1回で数えます。あなたのブラウザ（?me=1 を付けたもの）は数えません。
        </p>
      </div>
      {!f.visits ? (
        <p className="text-sm text-ink-2">まだ訪問がありません。</p>
      ) : (
        <>
          <ol className="space-y-2">
            {f.steps.map((s, i) => (
              <li key={s.key}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span>
                    {s.label}
                    {i === worst && worstRate < 1 && <span className="ml-2 text-xs" style={{ color: "var(--warning)" }}>▼ ここで一番減っています</span>}
                  </span>
                  <span className="num shrink-0">
                    <b>{s.visitors}人</b>
                    <span className="ml-2 text-xs text-ink-2">{pc(s.ofVisits)}</span>
                    {i > 0 && f.steps[i - 1].visitors > 0 && <span className="ml-2 text-xs text-muted">前の段から {pc(s.visitors / f.steps[i - 1].visitors)}</span>}
                  </span>
                </div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(1, (s.ofVisits ?? 0) * 100)}%`, background: "var(--accent)" }} />
                </div>
              </li>
            ))}
          </ol>
          {!f.hasEvents && (
            <p className="text-xs text-muted">
              「読んだ」「ボタン」「入力」の数は、公開サイトにページの中の動きの記録がまだ届いていないため0になっています（Supabase の表の追加と、LPサイトの反映が必要です）。
            </p>
          )}
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <div className="mb-1 text-xs text-muted">どこまで読んだか</div>
              <ul className="space-y-1">
                {f.depth.map((d) => (
                  <li key={d.percent} className="num flex justify-between"><span>{d.percent === 100 ? "最後まで" : `${d.percent}%まで`}</span><span>{d.visitors}人（{pc(f.visits ? d.visitors / f.visits : null)}）</span></li>
                ))}
              </ul>
            </div>
            {f.sections.length > 0 && !isTool && (
              <div>
                <div className="mb-1 text-xs text-muted">見られた部分（半分以上が画面に入った人）</div>
                <ul className="space-y-1">
                  {f.sections.map((s) => <li key={s.section} className="num flex justify-between"><span>{s.section}</span><span>{s.visitors}人</span></li>)}
                </ul>
              </div>
            )}
            {f.errors > 0 && <p className="text-xs" style={{ color: "var(--critical)" }}>登録しようとして失敗した人: {f.errors}人</p>}
          </div>
        </>
      )}
    </section>
  );
}
