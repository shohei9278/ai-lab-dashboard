import Link from "next/link";
import { PageIntro } from "@/components/PageIntro";
import { InterventionCard } from "@/components/InterventionList";
import { ShowMore } from "@/components/ShowMore";
import { aiImprovements, listInterventions, monthlyImprovements, operationCounts } from "@/lib/interventions";
import { modelInfo } from "@/lib/models";
import { sourceLabel } from "@/lib/plan";
import { isOwner } from "@/lib/viewer";
import { EditAnswer, HideIntervention, InterventionForm } from "./InterventionForm";

export const dynamic = "force-dynamic";

// 改善の記録: 人が見つけて決めたことと、AIが提案して人が答えたことを並べ、どこを誰が直したかを残す
export default async function InterventionsPage() {
  const owner = await isOwner();
  const list = listInterventions();
  const ai = aiImprovements();
  const months = monthlyImprovements();
  const ops = operationCounts();
  const aiDone = ai.filter((r) => r.status === "done").length;
  return (
    <div className="space-y-4">
      <PageIntro title="改善の記録">
        本プロジェクトでは、設計・仕様検討をAIとの対話で進め、コード生成には主にClaude Codeを活用しています。人間は問題の発見、方針決定、動作確認を担当し、原因調査や修正にもAIを活用しています。人が見つけて決めたことと、AIの社員が運営の中で提案し、人が「やった」「見送り」と答えたことを分けて記録しています。
      </PageIntro>

      {months.length > 0 && (
        <section className="card space-y-3 p-4">
          <div>
            <h2 className="font-bold">月ごとの件数</h2>
            <p className="text-xs text-muted">改善のきっかけが、人とAIのどちらから来たか。AIの提案は、人が答えた月で数えています。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 pr-3 font-normal">月</th>
                  <th className="py-1 pr-3 text-right font-normal">人が見つけた・決めた</th>
                  <th className="py-1 pr-3 text-right font-normal">AIの提案で入った</th>
                  <th className="py-1 text-right font-normal">AIの提案を見送った</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {months.map((m) => (
                  <tr key={m.month}>
                    <td className="num py-1.5 pr-3">{m.month.replace("-", "/")}</td>
                    <td className="num py-1.5 pr-3 text-right">{m.human}</td>
                    <td className="num py-1.5 pr-3 text-right">{m.aiDone}</td>
                    <td className="num py-1.5 text-right text-ink-2">{m.aiDeclined}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">AIの事業運営への介入（自動集計）</h2>
          <p className="text-xs text-muted">AIが進めている案件に、人が手を入れた回数です。処理の記録から数えています（デモの案件は除く）。</p>
        </div>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ops.map((o) => (
            <div key={o.label} className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-ink-2">{o.label}</dt>
              <dd className="num text-xl font-bold">{o.n}<span className="text-xs font-normal text-muted">回</span></dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-bold">AIが提案した改善（入った{aiDone}件・見送った{ai.length - aiDone}件）</h2>
          <p className="text-xs text-muted">AIの社員が朝会・定例会議・作業の途中で出した「仕組みの改善」に、人が答えたものです。ひとことは人が書いています。提案の中身は<Link href="/proposals" className="underline">提案箱</Link>にあります。</p>
        </div>
        {ai.length ? (
          <ShowMore as="ul" initial={10} className="card divide-y divide-line">
            {ai.map((r) => {
              const m = r.proposer ? modelInfo(r.proposer) : null;
              return (
                <li key={r.id} className="space-y-1 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="text-xs" style={{ color: r.status === "done" ? "var(--good)" : "var(--muted)" }}>{r.status === "done" ? "✓ 入った" : "– 見送り"}</span>
                    <span className="num text-xs text-muted">{r.day.slice(5).replace("-", "/")}</span>
                    <span className="font-medium">{r.title}</span>
                  </div>
                  <div className="text-xs text-muted">
                    {m && <>提案: <span style={{ color: `var(--series-${m.provider})` }}>{m.label}</span>・</>}{sourceLabel(r)}{r.score !== null ? `・ほかのAIの評価 ${r.score.toFixed(1)}点` : ""}
                  </div>
                  {r.note && <p className="text-xs text-ink-2">人のひとこと: {r.note}</p>}
                  {owner && <EditAnswer id={r.id} status={r.status} note={r.note} />}
                </li>
              );
            })}
          </ShowMore>
        ) : <p className="text-sm text-ink-2">まだありません。</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-bold">人が見つけた・決めた（開発・保守 {list.length}件）</h2>
        {owner && <InterventionForm />}
        <ShowMore initial={15} className="space-y-3">
          {list.map((v) => (
            <InterventionCard key={v.id} v={v} footer={owner && <InterventionForm key={`${v.id}-${v.title}-${v.day}`} edit={v} />}>
              {owner && <HideIntervention id={v.id} />}
            </InterventionCard>
          ))}
        </ShowMore>
      </section>
    </div>
  );
}
