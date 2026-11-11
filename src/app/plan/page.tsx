import Link from "next/link";
import { isOwner } from "@/lib/viewer";
import { PageIntro } from "@/components/PageIntro";
import { getSettings } from "@/lib/db";
import { jstDateTime } from "@/lib/format";
import { autoPlatforms } from "@/lib/snsApi";
import { planProgress, recentPlans, todayPlan } from "@/lib/plan";
import { AiPostsReview, OpenRequests, PlanHistory, PlanSummary, PlanTasks, RequestHistory, dayLabel } from "./PlanView";
import { Replan } from "./PlanActions";

export const dynamic = "force-dynamic";

// 毎日の計画: AIが毎朝決めた「今のネック」と「今日やること」、どこまで達成したか
export default async function PlanPage() {
  const s = getSettings();
  const owner = await isOwner();
  const plan = todayPlan();
  const past = recentPlans(15).filter((p) => p.id !== plan?.id).slice(0, 14);
  const g = plan ? planProgress(plan) : null;
  const notes = [
    !s.dailyPlan && "設定で「毎日の計画」がオフのため、計画は作られません。",
    !s.autoPost && "自動投稿がオフのため、投稿の予定は入りません（ページを直す・新しい案件を休むなどだけ）。",
    s.autoPost && !autoPlatforms().length && "自動で投稿できる場所のキーがないため、投稿の予定は入りません。",
    s.killSwitch && "緊急停止中のため、予定は実行されません。",
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-6">
      <PageIntro title="毎日の計画" actions={owner && s.dailyPlan ? <Replan label={plan ? "計画を作り直す（約10〜20円）" : "今日の計画を作る（約10〜20円）"} /> : undefined}>
        <Link href="/#plan" className="underline">ホームに戻る</Link>。毎朝（{Math.min(s.dailyHour, 8)}時以降）、AIが公開中の全案件と最近の結果を振り返り、今いちばんのネックを1つ決めて、今日やること（宣伝の投稿・普通の投稿・ページを直す・新しい案件を休む など）を決めます。
        時刻が来た予定から自動で実行し、翌朝その結果を振り返って次の計画に活かします。投稿は場所ごとに直近24時間で{s.postSafetyPerDay}件の安全装置があり、返信・フォロー・いいねなど、他人への働きかけはしません。
      </PageIntro>
      {notes.length > 0 && <div className="card space-y-1 p-3 text-sm text-ink-2">{notes.map((n) => <p key={n}>{n}</p>)}</div>}

      {plan && g ? (
        <>
          <section className="card space-y-3 p-4" style={{ borderColor: "var(--accent)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold">{dayLabel(plan.day)}の計画</h2>
              <span className="text-xs text-muted">{jstDateTime(plan.created_at)} に作成</span>
            </div>
            <PlanSummary plan={plan} />
            <OpenRequests owner={owner} collapsed={!owner} />
          </section>

          <section className="card space-y-2 p-4">
            <h2 className="font-bold">AIの見立て</h2>
            <div className="text-sm"><span className="text-muted">根拠: </span>{g.content.evidence}</div>
            <div className="text-sm"><span className="text-muted">これまでの振り返り: </span>{g.content.review}</div>
            {g.goals.map((x) => <div key={x.metric} className="text-sm"><span className="text-muted">目標の理由（{x.metric === "visits" ? "訪問" : "登録・利用"}）: </span>{x.why}</div>)}
            {plan.idea_note && <div className="text-sm"><span className="text-muted">次のアイデア出しに伝えること: </span>{plan.idea_note}</div>}
          </section>

          <section className="card space-y-3 p-4">
            <h2 className="font-bold">今日の予定（{g.done}/{g.total}件 済み）</h2>
            <PlanTasks plan={plan} owner={owner} />
          </section>
        </>
      ) : (
        <section className="card p-4 text-sm text-ink-2">
          今日の計画はまだありません。{s.dailyPlan ? `${Math.min(s.dailyHour, 8)}時以降の自動の見回り（5分ごと）で作られます。` : ""}
        </section>
      )}

      <section id="posts" className="card scroll-mt-4 space-y-3 p-4">
        <div>
          <h2 className="font-bold">AIだけで出した投稿の確認（直近3日）</h2>
          <p className="text-xs text-muted">人が見ないまま出た投稿です。「出すべきでなかった」を付けると、その投稿と理由を次の計画・投稿を書くAIに渡し、同じ書き方を避けさせます（投稿そのものは消しません。消すときは各サービスで消してください）。</p>
        </div>
        <AiPostsReview owner={owner} />
      </section>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">これまでの計画と達成度</h2>
        <PlanHistory plans={past} />
      </section>

      <p className="text-sm">どの投稿の手が効いたかは、<a href="/growth/stats" className="text-accent underline">集客 → 効いた手</a>で見られます。</p>
      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-bold">提案箱への返事</h2>
          <p className="text-xs text-muted">返事（やった・やらない、ひとこと）は、次の計画でAIが見ます。やってもらったことの前後で数字がどう変わったかも振り返ります。</p>
        </div>
        <RequestHistory />
      </section>
      <p className="text-xs text-muted">普通の投稿にはリンクがないため、そこから何人来たかは分かりません。反応の数と、全体の訪問の増え方で、効いたかどうかを見ます。設定は<Link href="/settings" className="underline">設定</Link>で変えられます。</p>
    </div>
  );
}
