import Link from "next/link";
import { db } from "@/lib/db";
import { HIDDEN, isOwner } from "@/lib/viewer";
import { ShowMore } from "@/components/ShowMore";
import { PageIntro } from "@/components/PageIntro";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { CHOICE_LABEL, SOURCE_LABEL, listExternalVoices, listVoiceEffects, outsideSummaries } from "@/lib/outside";
import { listResearch, type Finding } from "@/lib/research";
import { AddOutsideVoice, DeleteOutsideVoice } from "./OutsideActions";

export const dynamic = "force-dynamic";

// 外の声: 実際の人の反応を集め、AIの判断がそれでどう変わったかを見る
export default async function OutsidePage() {
  const owner = await isOwner();
  const sums = outsideSummaries();
  const effects = listVoiceEffects();
  const all = listExternalVoices({ limit: 500 });
  const byId = new Map(all.map((v) => [v.id, v]));
  const research = listResearch(30);
  const rById = new Map(research.map((r) => [r.id, r]));
  const titles = new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((p) => [p.id, p.title]));
  // 来た人には、利用者が書いた文と、あなたが聞いた声の中身を伏せる（選んだ項目と件数は出す）
  const shown = (t: string) => (owner || !t ? t : HIDDEN);
  return (
    <div className="space-y-6">
      <PageIntro title="外の声">
        AIどうしの採点や会議では分からない、実際の人の反応です。公開中のページ右下の「ひとこと聞かせてください」（匿名・1タップ）に届いた声と、あなたが知人やコミュニティで聞いた声、SNSのコメント、ページのどこで離れたかをまとめています。
        外の声は、朝会・撤退や継続の判断・定例会議・アイデア出しで、AIどうしの解釈より優先する材料として渡しています。朝会のAIが「分からないこと」を決めてWebで調べた結果（調べたこと）も、出典つきで一緒に渡します。AIがそれらを受けて判断を変えたら、「変わった判断」に残ります。
      </PageIntro>

      {owner && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">聞いた声を記録する</h2>
          <AddOutsideVoice projects={sums.map((x) => ({ id: x.project.id, title: x.project.title }))} />
        </section>
      )}

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">外の声・調べたことで変わった判断（{effects.length}件）</h2>
          <p className="text-xs text-muted">AIが「どの声・どの調べものを受けて、何を変えたか」を自分で書いたものです。実際の人や外の情報に触れたことで、AIの判断が変わった具体例になります。</p>
        </div>
        {effects.length ? (
          <ShowMore as="ul" initial={5} className="space-y-2 text-sm">
            {effects.map((e) => (
              <li key={e.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap gap-x-2 text-xs text-ink-2">
                  <span>{e.scene}</span>
                  {e.model_id && <span style={{ color: `var(--series-${modelInfo(e.model_id).provider})` }}>{modelInfo(e.model_id).label}</span>}
                  {e.project_id && <Link href={`/projects/${e.project_id}`} className="underline">{titles.get(e.project_id) ?? `#${e.project_id}`}</Link>}
                  <span className="num text-muted">{jstDateTime(e.at)}</span>
                </div>
                <p className="mt-1 font-medium">{e.change}</p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                  {(JSON.parse(e.voice_ids) as number[]).map((id) => {
                    const v = byId.get(id);
                    return v ? <li key={id}>← 声{id}（{SOURCE_LABEL[v.source]}{v.choice ? `「${CHOICE_LABEL[v.choice]}」` : ""}）{shown(v.text)}</li> : null;
                  })}
                  {(JSON.parse(e.research_ids ?? "[]") as number[]).map((id) => {
                    const r = rById.get(id);
                    return r ? <li key={`r${id}`}>← 調べもの{id}「{r.question}」</li> : null;
                  })}
                </ul>
              </li>
            ))}
          </ShowMore>
        ) : <p className="text-sm text-ink-2">まだありません。外の声が届き、AIがそれを受けて何かを変えると、ここに出ます。</p>}
      </section>

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">調べたこと（{research.length}件）</h2>
          <p className="text-xs text-muted">朝会の担当AIが「今の判断に効くのに分からないこと」を1日1件まで決め、Webの公開情報で調べたものです。出典は、AIが実際に見たページだけを残しています。調べても分からなければ、保留のまま残します。</p>
        </div>
        {research.length ? (
          <ShowMore as="ul" initial={5} className="space-y-3">
            {research.map((r) => {
              const f = r.findings ? (JSON.parse(r.findings) as Finding[]) : [];
              const st = { answered: ["分かった", "var(--good)"], unknown: ["分からなかった（保留）", "var(--warning)"], failed: ["調べられなかった", "var(--critical)"], pending: ["調べる前", "var(--muted)"], running: ["調べている", "var(--accent)"] }[r.status];
              return (
                <li key={r.id} id={`research-${r.id}`} className="space-y-1 rounded-lg border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-ink-2">
                    <span style={{ color: st[1] }} className="font-medium">{st[0]}</span>
                    <span>調べもの{r.id}</span>
                    {r.asked_by && <span style={{ color: `var(--series-${modelInfo(r.asked_by).provider})` }}>問い: {modelInfo(r.asked_by).label}</span>}
                    {r.project_id && <Link href={`/projects/${r.project_id}`} className="underline">{titles.get(r.project_id) ?? `#${r.project_id}`}</Link>}
                    <span className="num text-muted">{jstDateTime(r.done_at ?? r.at)}{r.searches ? `・検索${r.searches}回` : ""}</span>
                  </div>
                  <p className="font-medium">{r.question}</p>
                  {r.why && <p className="text-xs text-muted">分かると変わる判断: {r.why}</p>}
                  {r.summary && <p>{r.summary}</p>}
                  {f.length > 0 && (
                    <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">
                      {f.map((x, i) => <li key={i}>{x.point}（<a href={x.url} target="_blank" rel="noreferrer" className="underline">{x.title || new URL(x.url).hostname}</a>）</li>)}
                    </ul>
                  )}
                  {r.unknown && <p className="text-xs text-ink-2">まだ分からない: {r.unknown}</p>}
                </li>
              );
            })}
          </ShowMore>
        ) : <p className="text-sm text-ink-2">まだありません。明日以降の朝会で、AIが分からないことを決めると調べ始めます。</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">案件ごとの外の声</h2>
        {sums.map((x) => {
          const empty = !x.site.length && !x.voices.length && !x.comments.length && !x.funnel;
          return (
            <article key={x.project.id} className="card space-y-2 p-4">
              <h3 className="font-bold"><Link href={`/projects/${x.project.id}`} className="hover:underline">#{x.project.id} {x.project.title}</Link></h3>
              {empty && <p className="text-sm text-muted">まだ外の声はありません。</p>}
              {x.site.length > 0 && (
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className="text-xs text-muted">公開ページの質問:</span>
                  {x.site.map((c) => <span key={c.choice} className="rounded-full bg-surface-2 px-2 py-0.5">{CHOICE_LABEL[c.choice] ?? c.choice} <b className="num">{c.n}</b></span>)}
                </div>
              )}
              {x.voices.filter((v) => v.text).length > 0 && (
                <ul className="space-y-1 text-sm">
                  {x.voices.filter((v) => v.text).map((v) => (
                    <li key={v.id} className="flex gap-2">
                      <span className="shrink-0 text-xs text-muted">声{v.id}・{SOURCE_LABEL[v.source]}{v.choice ? `「${CHOICE_LABEL[v.choice]}」` : ""}</span>
                      <span className="flex-1">{shown(v.text)}</span>
                      {owner && v.source !== "site" && <DeleteOutsideVoice id={v.id} />}
                    </li>
                  ))}
                </ul>
              )}
              {x.comments.length > 0 && <p className="text-xs text-ink-2">SNSのコメント {x.comments.length}件（中身は「集客」で見られます）</p>}
              {x.funnel && <p className="whitespace-pre-wrap text-xs text-ink-2">{x.funnel}</p>}
            </article>
          );
        })}
      </section>

      {all.filter((v) => !v.project_id).length > 0 && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">全体についての声</h2>
          <ul className="space-y-1 text-sm">
            {all.filter((v) => !v.project_id).map((v) => (
              <li key={v.id} className="flex gap-2">
                <span className="shrink-0 text-xs text-muted">声{v.id}・{SOURCE_LABEL[v.source]}</span>
                <span className="flex-1">{shown(v.text)}</span>
                {owner && <DeleteOutsideVoice id={v.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
