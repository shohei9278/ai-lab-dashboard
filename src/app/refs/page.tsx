import { listRefs, type RefTags } from "@/lib/designRefs";
import { PageIntro } from "@/components/PageIntro";
import { RefActions, Bookmarklet, BulkAdd } from "./RefActions";

export const dynamic = "force-dynamic";

// デザインの参考のライブラリ
export default function RefsPage() {
  const refs = listRefs();
  const ok = refs.filter((r) => r.status === "ok");
  const waiting = refs.filter((r) => r.status === "queued").length;
  return (
    <div className="space-y-6">
      <PageIntro title="デザインの参考">
        AIがページをデザインするときに見せる、参考のLPです。あなたが選んだページの最初の画面を撮り、AIが雰囲気・業種・構成・配色のタグを付けます。
        参考は「雰囲気と質」のためだけに使い、配置や文言はまねさせません。公開サイトには載りません。
      </PageIntro>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">集め方</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>下の「参考に追加」のボタンを、ブラウザのブックマークバーにドラッグして置く（最初の1回だけ）</li>
          <li>LPアーカイブなどで良いLPを探し、<b>元のLPのページ</b>を開く（まとめサイトの画像は、規約で保存できないため使いません）</li>
          <li>ブックマークバーの「参考に追加」を押す。小さな窓が出て、すぐ閉じます</li>
        </ol>
        <Bookmarklet />
        <BulkAdd />
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">ライブラリ（{ok.length}件{waiting ? `・取り込み中 ${waiting}件` : ""}）</h2>
        {refs.length === 0 ? (
          <div className="card p-6 text-sm text-ink-2">まだありません。20〜30件あると、案件ごとに合う参考を選べるようになります（2件以上で使い始めます）。</div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {refs.map((r) => {
              const t = r.tags ? (JSON.parse(r.tags) as RefTags) : null;
              return (
                <li key={r.id} className="card space-y-2 p-3 text-sm">
                  {r.shot_pc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/refs/${r.shot_pc}`} alt={r.title ?? r.url} className="aspect-[16/10] w-full rounded-lg border border-line object-cover object-top" />
                  ) : (
                    <div className="flex aspect-[16/10] items-center justify-center rounded-lg bg-surface-2 text-xs text-muted">
                      {r.status === "queued" ? "画面を撮っています…" : "取り込めませんでした"}
                    </div>
                  )}
                  <div className="line-clamp-1 font-medium" title={r.title ?? ""}>{r.title || r.url}</div>
                  {t && <div className="flex flex-wrap gap-1 text-[11px]">{[t.mood, t.industry, t.layout, t.palette, t.typography].filter(Boolean).map((x) => <span key={x} className="rounded bg-surface-2 px-1.5 py-0.5 text-ink-2">{x}</span>)}</div>}
                  {r.note && <p className="text-xs text-ink-2">{r.note}</p>}
                  {r.error && <p className="text-xs" style={{ color: "var(--critical)" }}>{r.error}</p>}
                  <div className="flex items-center justify-between text-xs text-muted">
                    <a href={r.url} target="_blank" rel="noreferrer" className="truncate underline">元のページ ↗</a>
                    <span>参考にした回数 {r.used}</span>
                    <RefActions id={r.id} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
