import Link from "next/link";
import { pendingApprovals } from "@/lib/views";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PageIntro } from "@/components/PageIntro";
import { isOwner } from "@/lib/viewer";
import { getSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

// AIの作業待ち: 人の判断は要らず、AIが自動で進めている作業（運営者が決めた。判断待ちは、人の判断が要るものだけにする）
// いまは、クラウドの Claude Code（ルーティン）が自動で作る・直す開発待ち（toolRoutine.ts の autoWork）
export default async function QueuePage() {
  const owner = await isOwner();
  const items = pendingApprovals(undefined, owner, "auto");
  const s = getSettings();
  return (
    <div className="space-y-4">
      <PageIntro title="AIの作業待ち">
        人の判断は要らず、AIが自動で進めている作業です。ツールの開発待ちは、クラウドの Claude Code（ルーティン）が順に作ります（同時に{s.toolRoutineConcurrent}件・1日{s.toolRoutinePerDay}件まで。設定で変えられます）。頼んで3時間たっても入らなかったものは、自動で1回だけ頼み直し、それでも入らなければ<Link href="/approvals" className="text-accent underline">判断待ち</Link>に出します。
      </PageIntro>
      {items.length ? (
        <div className="space-y-3">{items.map((a) => <ApprovalCard key={a.id} a={a} />)}</div>
      ) : (
        <div className="card p-6 text-sm text-ink-2">いまAIの作業待ちはありません。</div>
      )}
    </div>
  );
}
