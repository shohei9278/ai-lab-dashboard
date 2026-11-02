import { latestTrends } from "@/lib/trends";
import { RefreshTrends } from "./RefreshTrends";

// いま世の中で話題のこと（毎日自動で取得して、アイデア出しと集客の作戦に渡している）
export function Trends() {
  const { fetchedAt, items } = latestTrends();
  const google = items.filter((x) => x.source === "google");
  const cats = [...new Set(items.filter((x) => x.source === "hatena").map((x) => x.category!))];
  return (
    <section className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">いま世の中で話題のこと</h2>
          <p className="text-xs text-muted">
            Googleトレンドの急上昇ワードと、はてなブックマークの人気記事を毎日1回取り、AIのアイデア出しと集客の作戦に渡しています（無料）。
            事件や事故など、人の不幸に乗った企画はしないようAIに指示しています。
            {fetchedAt ? `最後に取得: ${fetchedAt.slice(5, 16)}（UTC）` : "まだ取得していません。"}
          </p>
        </div>
        <RefreshTrends />
      </div>
      {items.length > 0 && (
        <div className="grid gap-4 text-sm lg:grid-cols-2">
          <div>
            <h3 className="mb-1 text-xs font-bold text-ink-2">Googleで急に検索が増えている言葉</h3>
            <ul className="flex flex-wrap gap-1.5">
              {google.map((x) => (
                <li key={x.title} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs" title={x.news}>
                  {x.title}<span className="num ml-1 text-muted">{x.traffic}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            {cats.map((c) => (
              <div key={c}>
                <h3 className="mb-1 text-xs font-bold text-ink-2">はてなブックマークでよく読まれている記事（{c}）</h3>
                <ul className="space-y-0.5 text-xs">
                  {items.filter((x) => x.category === c).slice(0, 5).map((x) => (
                    <li key={x.url ?? x.title} className="truncate">
                      <a href={x.url} target="_blank" rel="noreferrer" className="hover:underline">{x.title}</a>
                      <span className="num ml-1 text-muted">{x.count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
