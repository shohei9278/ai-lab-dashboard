import Link from "next/link";
import { db } from "@/lib/db";
import { jstDateTime } from "@/lib/format";
import { AUTO_PLATFORMS, type AutoPlatform } from "@/lib/snsApi";
import { BOTTLENECK_LABEL, GOAL_LABEL, TASK_KIND_LABEL, certaintyLabel, planProgress, type PlanRow, type TaskRow } from "@/lib/plan";
import { CancelTask } from "./PlanActions";
import { postStats, type StatRow } from "@/lib/postStats";

// 今日の計画の「どこまで達成したか」を、予定の消化と目標の数字の2つの棒で見せる

const STATUS: Record<TaskRow["status"], { icon: string; label: string; color: string }> = {
  done: { icon: "✓", label: "済み", color: "var(--good)" },
  running: { icon: "●", label: "実行中", color: "var(--accent)" },
  pending: { icon: "○", label: "予定", color: "var(--muted)" },
  failed: { icon: "✕", label: "失敗", color: "var(--critical)" },
  skipped: { icon: "–", label: "見送り", color: "var(--warning)" },
  cancelled: { icon: "–", label: "取りやめ", color: "var(--muted)" },
};

const dayLabel = (day: string) => {
  const d = new Date(`${day}T00:00:00+09:00`);
  return `${d.getMonth() + 1}/${d.getDate()}（${"日月火水木金土"[d.getDay()]}）`;
};

function Meter({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  const rate = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-2">{label}</span>
        <span className="num font-bold">
          {value}<span className="text-xs font-normal text-muted"> / {max}{sub}</span>
          <span className="ml-2 text-xs font-normal text-ink-2">{Math.round(rate * 100)}%</span>
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${rate * 100}%`, background: rate >= 1 ? "var(--good)" : "var(--accent)" }} />
      </div>
    </div>
  );
}

const titles = () => new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((p) => [p.id, p.title]));

// 上の部分: ネック・方針・2つの棒（ホームのカードと計画のページで共通）
export function PlanSummary({ plan }: { plan: PlanRow }) {
  const g = planProgress(plan);
  const next = g.tasks.find((t) => t.status === "pending" || t.status === "running");
  const t = titles();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full px-2 py-0.5 text-xs font-medium text-accent-ink" style={{ background: "var(--accent)" }}>
          今のネック: {BOTTLENECK_LABEL[g.content.bottleneck]}
        </span>
        <span className="text-xs text-muted">確かさ {certaintyLabel(g.content.certainty)}</span>
      </div>
      <p className="font-medium">{g.content.focus}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Meter label="今日の予定" value={g.done} max={g.total} sub="件 済み" />
        {g.goals.map((x) => <Meter key={x.metric} label={`目標: ${GOAL_LABEL[x.metric]}（全案件の合計）`} value={x.actual} max={x.target} sub="人" />)}
      </div>
      {(g.failed > 0 || g.skipped > 0) && (
        <p className="text-xs text-ink-2">失敗 {g.failed}件・見送り {g.skipped}件（理由は下の予定に出ています）</p>
      )}
      {next && (
        <p className="text-sm text-ink-2">
          次: <span className="num">{next.at_time}</span> {TASK_KIND_LABEL[next.kind]}
          {next.platform ? `（${AUTO_PLATFORMS[next.platform as AutoPlatform]?.label ?? next.platform}）` : ""}
          {next.project_id ? ` ${t.get(next.project_id) ?? `#${next.project_id}`}` : ""}「{next.angle}」
        </p>
      )}
      {plan.pause_new ? <p className="text-sm text-ink-2">今日は新しい案件づくりを休みます（{g.content.pause_reason || "今ある案件を優先"}）</p> : null}
    </div>
  );
}

// 予定の一覧（計画のページ）
export function PlanTasks({ plan, owner }: { plan: PlanRow; owner: boolean }) {
  const g = planProgress(plan);
  const t = titles();
  if (!g.tasks.length) return <p className="text-sm text-ink-2">今日の予定はありません。</p>;
  return (
    <ol className="space-y-2">
      {g.tasks.map((x) => {
        const st = STATUS[x.status];
        return (
          <li key={x.id} className="flex gap-3 rounded-lg border border-line p-3" style={x.status === "cancelled" ? { opacity: 0.6 } : undefined}>
            <span className="num w-12 shrink-0 text-sm font-medium">{x.at_time}</span>
            <span aria-hidden className="w-4 shrink-0 text-center font-bold" style={{ color: st.color }}>{st.icon}</span>
            <div className="min-w-0 flex-1 space-y-1 text-sm">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-medium" style={{ color: st.color }}>{st.label}</span>
                <span className="rounded bg-surface-2 px-1.5 text-xs">{TASK_KIND_LABEL[x.kind]}</span>
                {x.platform && <span className="text-xs text-ink-2">{AUTO_PLATFORMS[x.platform as AutoPlatform]?.label ?? x.platform}</span>}
                {x.project_id && <Link href={`/projects/${x.project_id}`} className="text-xs underline">{t.get(x.project_id) ?? `#${x.project_id}`}</Link>}
                {owner && x.status === "pending" && <span className="ml-auto"><CancelTask id={x.id} /></span>}
              </div>
              <div className="text-ink-2">「{x.angle}」</div>
              {x.reason && <div className="text-xs text-muted">理由: {x.reason}</div>}
              {x.result && (
                <div className="rounded bg-surface-2 px-2 py-1 text-xs text-ink-2">
                  {x.result}
                  {x.result_url && <> <a href={x.result_url} target="_blank" rel="noreferrer" className="underline">投稿を見る ↗</a></>}
                  {x.done_at && <span className="ml-2 text-muted">{jstDateTime(x.done_at)}</span>}
                  {x.status === "done" && x.kind !== "improve" && (
                    <span className="ml-2 text-muted">
                      {x.reactions_at ? `反応: いいね${x.likes ?? 0}・返信${x.replies ?? 0}・リポスト${x.reposts ?? 0}` : "反応は翌日に取り込みます"}
                    </span>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// 過去の計画の達成度（計画のページ）
export function PlanHistory({ plans }: { plans: PlanRow[] }) {
  if (!plans.length) return <p className="text-sm text-ink-2">まだありません。</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-muted">
          <tr><th className="py-1 pr-3 font-normal">日</th><th className="py-1 pr-3 font-normal">ネック</th><th className="py-1 pr-3 font-normal">予定</th><th className="py-1 pr-3 font-normal">目標</th></tr>
        </thead>
        <tbody>
          {plans.map((p) => {
            const g = planProgress(p);
            return (
              <tr key={p.id} className="border-t border-line align-top">
                <td className="num whitespace-nowrap py-2 pr-3">{dayLabel(p.day)}</td>
                <td className="py-2 pr-3">{BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0]}<div className="text-xs text-muted">{g.content.focus}</div></td>
                <td className="num whitespace-nowrap py-2 pr-3">{g.done}/{g.total}件 <span className="text-xs text-ink-2">{Math.round(g.taskRate * 100)}%</span></td>
                <td className="num whitespace-nowrap py-2 pr-3">
                  {g.goals.map((x) => (
                    <div key={x.metric} style={{ color: x.rate >= 1 ? "var(--good)" : undefined }}>
                      {GOAL_LABEL[x.metric]} {x.actual}/{x.target}{x.rate >= 1 ? " ✓" : ""}
                    </div>
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// 効いた手の集計（場所と種類・時間帯・切り口の型）
export function PostStatsView() {
  const s = postStats();
  if (!s.total) return <p className="text-sm text-ink-2">まだ投稿がありません。</p>;
  const table = (title: string, rows: StatRow[]) => {
    const maxR = Math.max(0.01, ...rows.map((r) => r.avgReaction ?? 0));
    const maxV = Math.max(0.01, ...rows.map((r) => r.avgVisits ?? 0));
    const bar = (v: number | null, max: number) => v === null ? <span className="text-muted">—</span> : (
      <span className="inline-flex items-center gap-2">
        <span className="num w-8 text-right">{v.toFixed(1)}</span>
        <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-accent" style={{ width: `${(v / max) * 100}%` }} /></span>
      </span>
    );
    return (
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{title}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr><th className="py-1 pr-3 font-normal"></th><th className="py-1 pr-3 font-normal">件数</th><th className="py-1 pr-3 font-normal">宣伝からの訪問（平均）</th><th className="py-1 pr-3 font-normal">反応（平均）</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-line">
                  <td className="py-1.5 pr-3">{r.label}</td>
                  <td className="num py-1.5 pr-3">{r.n}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3">{bar(r.avgVisits, maxV)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3">{bar(r.avgReaction, maxR)}{r.reacted < r.n && r.reacted > 0 ? <span className="ml-1 text-xs text-muted">（{r.reacted}件で集計）</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-4">
      {table("場所と種類", s.byPlace)}
      {table("時間帯（日本時間）", s.byTime)}
      {table("切り口の型", s.byType)}
    </div>
  );
}

export { dayLabel };
