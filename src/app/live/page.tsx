import { liveSnapshot } from "@/lib/live";
import { LiveView } from "./LiveView";

export const dynamic = "force-dynamic";

// 眺める用の画面: 数秒ごとに、AIがやっていること・数字・会話・ログが入れ替わる
export default function LivePage() {
  return <LiveView initial={liveSnapshot()} />;
}
