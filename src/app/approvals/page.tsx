import { pendingApprovals } from "@/lib/views";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PageIntro } from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const items = pendingApprovals();
  return (
    <div className="space-y-4">
      <PageIntro title="判断待ち">
        AIが「ここから先は人の判断が必要」と止まっているものです。全自動では、AIのチェックで問題が残ったもの・承認なしの公開が上限に達したもの・広告費の上限を超える判断などだけがここに来ます。
        AIの提案と理由を読んで、承認・修正指示・却下を選んでください。
      </PageIntro>
      {items.length ? (
        <div className="space-y-3">{items.map((a) => <ApprovalCard key={a.id} a={a} />)}</div>
      ) : (
        <div className="card p-6 text-sm text-ink-2">
          判断待ちはありません。AIが自動で進めています。
        </div>
      )}
    </div>
  );
}
