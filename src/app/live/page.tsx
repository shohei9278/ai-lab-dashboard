import { liveSnapshot } from "@/lib/live";
import { isOwner } from "@/lib/viewer";
import { LiveView } from "./LiveView";

export const dynamic = "force-dynamic";

// ライブ: 数秒ごとに、AIがやっていること・数字・会話・ログが入れ替わる（終わった会議は会議室の議事録に残る）
export default async function LivePage() {
  return <LiveView initial={liveSnapshot({ guest: !(await isOwner()) })} />;
}
