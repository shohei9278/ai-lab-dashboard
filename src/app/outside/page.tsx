import Link from "next/link";
import { db } from "@/lib/db";
import { HIDDEN, isOwner } from "@/lib/viewer";
import { PageIntro } from "@/components/PageIntro";
import { jstDateTime } from "@/lib/format";
import { modelInfo } from "@/lib/models";
import { CHOICE_LABEL, SOURCE_LABEL, listExternalVoices, listVoiceEffects, outsideSummaries } from "@/lib/outside";
import { AddOutsideVoice, DeleteOutsideVoice } from "./OutsideActions";

export const dynamic = "force-dynamic";

// 外の声: 実際の人の反応を集め、AIの判断がそれでどう変わったかを見る
export default async function OutsidePage() {
  const owner = await isOwner();
  const sums = outsideSummaries();
  const effects = listVoiceEffects();
  const all = listExternalVoices({ limit: 500 });
  const byId = new Map(all.map((v) => [v.id, v]));
  const titles = new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((p) => [p.id, p.title]));
  // 来た人には、利用者が書いた文と、あなたが聞いた声の中身を伏せる（選んだ項目と件数は出す）
  const shown = (t: string) => (owner || !t ? t : HIDDEN);
  return (
    <div className="space-y-6">
      <PageIntro title="外の声">
        AIどうしの採点や会議では分からない、実際の人の反応です。公開中のページ右下の「ひとこと聞かせてください」（匿名・1タップ）に届いた声と、あなたが知人やコミュニティで聞いた声、SNSのコメント、ページのどこで離れたかをまとめています。
        外の声は、朝会・撤退や継続の判断・定例会議・アイデア出しで、AIどうしの解釈より優先する材料として渡しています。AIがそれを受けて判断を変えたら、下の「外の声で変わった判断」に残ります。
      </PageIntro>

      {owner && (
        <section className="card space-y-2 p-4">
          <h2 className="font-bold">聞いた声を記録する</h2>
          <AddOutsideVoice projects={sums.map((x) => ({ id: x.project.id, title: x.project.title }))} />
        </section>
      )}

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">外の声で変わった判断（{effects.length}件）</h2>
          <p className="text-xs text-muted">AIが「どの声を受けて、何を変えたか」を自分で書いたものです。実際の人に触れたことで、AIの判断が変わった具体例になります。</p>
        </div>
        {effects.length ? (
          <ul className="space-y-2 text-sm">
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
                </ul>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-ink-2">まだありません。外の声が届き、AIがそれを受けて何かを変えると、ここに出ます。</p>}
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
