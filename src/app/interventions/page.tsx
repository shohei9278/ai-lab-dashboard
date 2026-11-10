import { PageIntro } from "@/components/PageIntro";
import { InterventionCard } from "@/components/InterventionList";
import { listInterventions } from "@/lib/interventions";
import { isOwner } from "@/lib/viewer";
import { HideIntervention, InterventionForm } from "./InterventionForm";

export const dynamic = "force-dynamic";

// 人の手が入った記録: AIに任せきりではなく、どこで人が見つけて判断したかを残す
export default async function InterventionsPage() {
  const owner = await isOwner();
  const list = listInterventions();
  return (
    <div className="space-y-4">
      <PageIntro title="人の手の記録">
        このシステムのコードは Claude Code が書いています。問題を見つけ、原因を判断し、どう直すかを決めたのは人です。その記録を残しています。
      </PageIntro>
      {owner && <InterventionForm />}
      <div className="space-y-3">
        {list.map((v) => <InterventionCard key={v.id} v={v}>{owner && <HideIntervention id={v.id} />}</InterventionCard>)}
      </div>
    </div>
  );
}
