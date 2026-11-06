import { PageIntro } from "@/components/PageIntro";
import { GrowthTabs } from "@/components/LabTabs";
import { PostStatsView } from "../../plan/PlanView";

export const dynamic = "force-dynamic";

// 効いた手: これまでのAIの投稿を、場所・時間帯・切り口の型ごとにまとめたもの
export default function GrowthStatsPage() {
  return (
    <div className="space-y-6">
      <PageIntro title="集客">
        これまでのAIの投稿を、場所・時間帯・切り口の型ごとにまとめたものです。毎朝の朝会で、担当のAIがこれを見て、訪問や反応が多い手を多めに使い、まだ試していない手も少し混ぜます。
        反応は「いいね＋返信＋リポスト」で、投稿の翌日と3日後に取り込みます（X は翌日の1回だけ。1件 約0.75円）。件数が少ないうちは、偶然の差が大きいです。
      </PageIntro>
      <GrowthTabs current="/growth/stats" />
      <section className="card p-4">
        <PostStatsView />
      </section>
    </div>
  );
}
