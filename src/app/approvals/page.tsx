import Link from "next/link";
import { pendingApprovals } from "@/lib/views";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PageIntro } from "@/components/PageIntro";

export const dynamic = "force-dynamic";

export default function ApprovalsPage() {
  const items = pendingApprovals();
  return (
    <div className="space-y-4">
      <PageIntro title="承認待ち">
        AIが「ここから先は人の判断が必要」と止まっているものです。AIの提案と理由を読んで、承認・修正指示・却下を選んでください。
        お金がかかる操作や外部への公開は、必ずここを通ります。
      </PageIntro>
      {items.length ? (
        <div className="space-y-3">{items.map((a) => <ApprovalCard key={a.id} a={a} />)}</div>
      ) : (
        <div className="card p-6 text-sm text-ink-2">
          承認待ちはありません。<Link href="/" className="text-accent underline">ホーム</Link>でAIにアイデアを出させると、ここに届きます。
        </div>
      )}
    </div>
  );
}
