import Link from "next/link";
import { isOwner } from "@/lib/viewer";
import { PageIntro } from "@/components/PageIntro";
import { getSettings } from "@/lib/db";
import { jstDateTime } from "@/lib/format";
import { autoPlatforms } from "@/lib/snsApi";
import { planProgress, recentPlans, todayPlan } from "@/lib/plan";
import { RequestCount, PlanHistory, PlanSummary, PlanTasks, dayLabel } from "./PlanView";
import { Replan } from "./PlanActions";
import { METRIC_LABEL, VERDICT_LABEL, listTrials, trialStats } from "@/lib/trials";

export const dynamic = "force-dynamic";

// 毎日の計画: AIが毎朝決めた「今のネック」と「今日やること」、どこまで達成したか
export default async function PlanPage() {
  const s = getSettings();
  const owner = await isOwner();
  const plan = todayPlan();
  const past = recentPlans(15).filter((p) => p.id !== plan?.id).slice(0, 14);
  const g = plan ? planProgress(plan) : null;
  const trials = listTrials(10);
  const notes = [
    !s.dailyPlan && "設定で「毎日の計画」がオフのため、計画は作られません。",
    !s.autoPost && "自動投稿がオフのため、投稿の予定は入りません（ページを直す・新しい案件を休むなどだけ）。",
    s.autoPost && !autoPlatforms().length && "自動で投稿できる場所のキーがないため、投稿の予定は入りません。",
    s.killSwitch && "緊急停止中のため、予定は実行されません。",
  ].filter(Boolean) as string[];
  return (
    <div className="space-y-6">
      <PageIntro title="毎日の計画" actions={owner && s.dailyPlan ? <Replan label={plan ? "計画を作り直す（約10〜20円）" : "今日の計画を作る（約10〜20円）"} /> : undefined}>
        毎朝（{Math.min(s.dailyHour, 8)}時以降）、AIが公開中の全案件と最近の結果を振り返り、今いちばんのネックを1つ決めて、今日やること（宣伝の投稿・普通の投稿・ページを直す・新しい案件を休む など）を決めます。
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
            <RequestCount owner={owner} />
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


      {/* 試し: 朝会が決めた「何を変えて、いつ・何の数字で判断するか」。判定日時まで結論を出さない（trials.ts） */}
      {trials.length > 0 && (
        <section className="card space-y-3 p-4">
          <h2 className="font-bold">試していること</h2>
          <p className="text-xs text-muted">何かを変えたときは、判定日時と見る数字、判断に要る訪問の下限を先に決めます。判定日時までは結論を出さず、下限に届かなければ保留して1回だけ延ばします。</p>
          <ul className="space-y-2">
            {trials.map((t) => {
              const st = t.status === "open" ? trialStats(t) : null;
              const badge = t.status === "open" ? (t.extended ? "判断保留（延長中）" : "判定待ち") : t.verdict ? VERDICT_LABEL[t.verdict] : "判断できなかった";
              return (
                <li key={t.id} className="rounded-lg bg-surface-2 p-3 text-sm">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs">{badge}</span>
                    {t.focus ? <span className="rounded-full border border-line px-2 py-0.5 text-xs">既存の案件の集客</span> : null}
                    <Link href={`/projects/${t.project_id}`} className="text-xs text-accent underline">#{t.project_id} {t.title}</Link>
                  </div>
                  <div className="mt-1 font-medium">{t.question}</div>
                  <div className="text-xs text-ink-2">変えたこと: {t.change}</div>
                  <div className="num mt-1 text-xs text-muted">
                    見る数字: {METRIC_LABEL[t.metric]}・判定 {jstDateTime(t.judge_at)}・下限 訪問{t.min_visits}人{st ? `・今 訪問${st.visits}・登録/利用${st.conversions}` : ""}
                  </div>
                  {t.result && <div className="mt-1 text-xs">結論: {t.result}</div>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">これまでの計画と達成度</h2>
        <PlanHistory plans={past} />
      </section>

      <p className="text-sm">どの投稿の手が効いたかは、<a href="/growth/stats" className="text-accent underline">集客 → 効いた手</a>で見られます。</p>
      <p className="text-xs text-muted">普通の投稿にはリンクがないため、そこから何人来たかは分かりません。反応の数と、全体の訪問の増え方で、効いたかどうかを見ます。設定は<Link href="/settings" className="underline">設定</Link>で変えられます。</p>
    </div>
  );
}
