import { listRefs, type RefTags } from "@/lib/designRefs";
import { PageIntro } from "@/components/PageIntro";
import { RefActions, Bookmarklet, BulkAdd, MakeNeeds } from "./RefActions";
import { savedNeeds } from "@/lib/refNeeds";

export const dynamic = "force-dynamic";

// デザインの参考のライブラリ
export default function RefsPage() {
  const refs = listRefs();
  const ok = refs.filter((r) => r.status === "ok");
  const waiting = refs.filter((r) => r.status === "queued").length;
  const needs = savedNeeds();
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
          <li>LPアーカイブや SANKOU! で良いLPを探し、<b>元のLPのページ</b>を開く（まとめサイトの画像や分類は、規約で保存・転用できないため使いません）</li>
          <li>ブックマークバーの「参考に追加」を押す。小さな窓が出て、すぐ閉じます</li>
        </ol>
        <Bookmarklet />
        <BulkAdd />
      </section>

      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-bold">AIがほしい参考</h2>
            <p className="text-xs text-muted">これから作りそうな案件と、今のライブラリの偏りを見比べて、足りない参考をAIが挙げます。リンクは、LPアーカイブを雰囲気・色・業種で絞り込んだページと、SANKOU! のサイト内検索です。</p>
          </div>
          <MakeNeeds label={needs ? "出し直す（約5円）" : "足りない参考を出す（約5円）"} />
        </div>
        {needs ? (
          <>
            <p className="text-sm text-ink-2">{needs.summary}<span className="ml-2 text-xs text-muted">{new Date(needs.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}時点</span></p>
            <ol className="grid gap-2 md:grid-cols-2">
              {needs.needs.map((n, i) => (
                <li key={i} className="rounded-lg border border-line p-3 text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{i + 1}. {n.what}</span>
                    <span className="num shrink-0 text-xs text-ink-2">目安 {n.count}件</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-2">{n.why}</p>
                  {n.keywords && <p className="mt-1 text-xs"><span className="text-muted">見どころ:</span> {n.keywords}</p>}
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    <a href={n.url} target="_blank" rel="noreferrer" className="text-accent underline">LPアーカイブで探す ↗</a>
                    {n.sankouUrl && <a href={n.sankouUrl} target="_blank" rel="noreferrer" className="text-accent underline">SANKOU!で探す ↗</a>}
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p className="text-sm text-ink-2">まだ出していません。右のボタンで出せます。</p>
        )}
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
