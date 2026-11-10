import { PageIntro } from "@/components/PageIntro";
import { InterventionCard } from "@/components/InterventionList";
import { listInterventions, operationCounts } from "@/lib/interventions";
import { isOwner } from "@/lib/viewer";
import { HideIntervention, InterventionForm } from "./InterventionForm";

export const dynamic = "force-dynamic";

// 人の手が入った記録: AIに任せきりではなく、どこで人が見つけて判断したかを残す
export default async function InterventionsPage() {
  const owner = await isOwner();
  const list = listInterventions();
  const ops = operationCounts();
  return (
    <div className="space-y-4">
      <PageIntro title="人の手の記録">
        本プロジェクトでは、設計・仕様検討をAIとの対話で進め、コード生成には主にClaude Codeを活用しています。人間は問題の発見、方針決定、動作確認を担当し、原因調査や修正にもAIを活用しています。AIの提案をそのまま採用するだけでなく、人間がどのような判断や介入を行ったかを記録しています。
      </PageIntro>
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
      <h2 className="font-bold">開発・保守への介入</h2>
      {owner && <InterventionForm />}
      <div className="space-y-3">
        {list.map((v) => <InterventionCard key={v.id} v={v}>{owner && <HideIntervention id={v.id} />}</InterventionCard>)}
      </div>
    </div>
  );
}
