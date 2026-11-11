import { HIDDEN, isOwner } from "@/lib/viewer";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { GrowthTabs } from "@/components/LabTabs";
import { getSettings } from "@/lib/db";
import { jstDateTime } from "@/lib/format";
import { listViral } from "@/lib/viralPosts";
import { xConfigured } from "@/lib/xPost";
import { listWants } from "@/lib/userWants";
import Link from "next/link";
import { AddViral, DeleteViral, DeleteWant, SearchControls, ViralBookmarklet } from "./ViralActions";

export const dynamic = "force-dynamic";

const num = (n: number | null) => (n === null ? "—" : n >= 10_000 ? `${(n / 10_000).toFixed(1)}万` : n.toLocaleString("ja-JP"));

// 話題の個人開発の投稿
export default async function ViralPage() {
  const s = getSettings();
  const ready = xConfigured();
  const owner = await isOwner();
  // 来た人には、他人の投稿の本文と「欲しい」の声の元の投稿を伏せる（AIのまとめと数字は出す）
  const rows = listViral().map((r) => (owner ? r : { ...r, text: r.text ? HIDDEN : r.text, author: r.author ? HIDDEN : r.author, url: "" }));
  const ok = rows.filter((r) => r.status === "ok");
  const waiting = rows.filter((r) => r.status === "queued").length;
  const wants = listWants().map((w) => (owner ? w : { ...w, text: HIDDEN, url: "" }));
  return (
    <div className="space-y-6">
      <PageIntro title="話題の投稿">
        Xでよく伸びた個人開発の投稿と、「こういうの欲しい」という声を集めます。伸びた投稿は、AIが「なぜ伸びたか」をまとめ、SNSの投稿の書き方・LPの見せ方・アイデア出しの参考に使います（何が受けたかは別の題材に応用しますが、同じアプリは作らせません）。
        「欲しい」の声は、そのままアイデア出しに渡し、声から生まれた案件には元の声を残します。どちらも拾うだけで、投稿者への返信やメンションはしません。画像は保存しません。
      </PageIntro>
      <GrowthTabs current="/viral" />

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">見つけた投稿を入れる</h2>
          <p className="text-xs text-muted">Xで「これは」と思った投稿を開いて、ブックマークバーのボタンを押します。読み取りは無料で、まとめのAIに1件数円かかります。</p>
          <ViralBookmarklet />
          <AddViral />
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">週1回の自動検索</h2>
          <p className="text-xs text-muted">
            直近7日の、作った人の投稿（「個人開発」「リリースしました」など）・使った人のシェア（診断・メーカーなど）・便利なものの紹介（「神ツール」「これ便利」など）を読み、いいね50以上で反応の大きいものを最大10件取り込みます。
            続けて「〇〇できるアプリ欲しい」などの声と、「〇〇の管理が面倒」のような困りごとを読み、いいね5以上のものからAIがプロダクトの需要だけを残します。読む件数は、検索ごとに順番に割り振ります。X の API は、読んだ投稿1件ごとに $0.005 かかります。
            {s.lastViralSearch ? ` 前回: ${jstDateTime(s.lastViralSearch)}` : " まだ検索していません。"}
          </p>
          {!ready && <p className="text-xs" style={{ color: "var(--critical)" }}>X の APIキーが設定されていないため、検索できません。</p>}
          <SearchControls enabled={s.viralSearch} count={s.viralSearchCount} wantsCount={s.wantsSearchCount} ready={ready} />
        </section>
      </div>

      <section className="space-y-2">
        <h2 className="font-bold">「欲しい」の声（{wants.length}件）</h2>
        {wants.length === 0 ? (
          <div className="card p-6 text-sm text-ink-2">まだありません。次の自動検索か「今すぐ検索する」で集まります。</div>
        ) : (
          <div className="card overflow-x-auto">
            <ShowMore as="table" initial={10} className="w-full text-sm" head={<thead className="text-left text-xs text-muted">
                <tr><th className="px-3 py-2">困りごと・欲しいもの</th><th className="px-3 py-2">誰が</th><th className="px-3 py-2 text-right">いいね</th><th className="px-3 py-2">案件</th><th className="px-3 py-2" /></tr>
              </thead>}>
                {wants.map((w) => (
                  <tr key={w.id} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      {w.problem}
                      <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">元の投稿</summary><p className="mt-1 whitespace-pre-wrap">{w.text}</p></details>
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-2">{w.who}</td>
                    <td className="num px-3 py-2 text-right">{num(w.likes)}</td>
                    <td className="px-3 py-2 text-xs">{w.project_id ? <Link href={`/projects/${w.project_id}`} className="text-accent underline">#{w.project_id} {w.project_title}</Link> : <span className="text-muted">まだ</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {w.url && <><a href={w.url} target="_blank" rel="noreferrer" className="text-accent underline">投稿 ↗</a>{" "}</>}
                      {!w.project_id && <DeleteWant id={w.id} />}
                    </td>
                  </tr>
                ))}
            </ShowMore>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">集めた投稿（{ok.length}件{waiting ? `・まとめ中 ${waiting}件` : ""}）</h2>
        {rows.length === 0 ? (
          <div className="card p-6 text-sm text-ink-2">まだありません。</div>
        ) : (
          <ShowMore as="ul" initial={10} className="grid gap-3 lg:grid-cols-2">
            {rows.map((r) => (
              <li key={r.id} className="card space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                  <span>{r.author ?? "（読み込み中）"}・{r.source === "search" ? "自動検索" : "手動"}{r.posted_at ? `・${jstDateTime(r.posted_at)}` : ""}</span>
                  <span className="flex gap-3">
                    {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="text-accent underline">投稿を見る ↗</a>}
                    <DeleteViral id={r.id} />
                  </span>
                </div>
                {r.text && <p className="line-clamp-3 whitespace-pre-wrap">{r.text}</p>}
                <div className="num flex flex-wrap gap-x-4 text-xs text-ink-2">
                  <span>いいね {num(r.likes)}</span>
                  <span>リポスト {num(r.reposts)}</span>
                  <span>ブックマーク {num(r.bookmarks)}</span>
                  <span>表示 {num(r.views)}</span>
                  {r.images ? <span>画像 {r.images}枚</span> : null}
                </div>
                {r.status === "queued" && <p className="text-xs text-muted">AIがまとめています…</p>}
                {r.status === "error" && <p className="text-xs" style={{ color: "var(--critical)" }}>{r.error}</p>}
                {r.a && r.status === "ok" && (
                  <dl className="grid grid-cols-[5.5em_1fr] gap-x-2 gap-y-1 border-t border-line pt-2 text-xs">
                    <dt className="text-muted">種類</dt><dd>{r.a.type === "share" ? "使った人の結果のシェア" : "作った人の紹介"}</dd>
                    <dt className="text-muted">分野・形</dt><dd>{r.a.genre}・{r.a.format}</dd>
                    {r.a.app && <><dt className="text-muted">どんなアプリか</dt><dd>{r.a.app}</dd></>}
                    <dt className="text-muted">伸びた理由</dt><dd>{r.a.why}</dd>
                    <dt className="text-muted">言葉の型</dt><dd>{r.a.hook}</dd>
                    <dt className="text-muted">見せ方</dt><dd>{r.a.visual}</dd>
                    <dt className="text-muted">活かせること</dt><dd>{r.a.takeaway}</dd>
                    <dt className="text-muted">切り口</dt><dd>{r.a.angle}</dd>
                  </dl>
                )}
              </li>
            ))}
          </ShowMore>
        )}
      </section>
    </div>
  );
}
