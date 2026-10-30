import Link from "next/link";
import { db, getSettings, monthAdSpendJpy, monthSpendBreakdownUsd, type EventRow, type ProjectRow, type Stage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { MODE_LABEL, STAGE_LABEL, activeLessons, modeComparison, projectTotals } from "@/lib/loop";
import { maskEvents, pendingCount } from "@/lib/views";
import { pct, yen } from "@/lib/format";
import { KillSwitch } from "@/components/KillSwitch";
import { DemoButtons, IdeaForm } from "@/components/IdeaForm";
import { DailyCard } from "@/components/DailyCard";
import { Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const COLUMNS: { stages: Stage[]; title: string; who: string }[] = [
  { stages: ["idea"], title: "① アイデア", who: "AIが提案 → 毎回承認モードではあなたが採用を判断" },
  { stages: ["lp"], title: "② LP作成", who: "AIが紹介ページを作ってチェック → あなたが公開を判断" },
  { stages: ["live"], title: "③ 集客中", who: "LPで事前登録を集める（自動モードはAIが改善も行う）" },
  { stages: ["deciding"], title: "④ 判断", who: "AIが続ける・改善・撤退を提案" },
  { stages: ["continued", "killed", "rejected"], title: "⑤ 結果", who: "終わった案件。AIが教訓を残す" },
];

const ACTOR = { ai: "AI", human: "あなた", system: "システム" } as const;

export default function Home() {
  const s = getSettings();
  const spend = monthSpendBreakdownUsd();
  const aiJpy = spend.total * s.usdJpy;
  const ratio = s.monthlyBudgetJpy ? aiJpy / s.monthlyBudgetJpy : 0;
  const projects = db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  const pendingByProject = new Set(
    (db().prepare("SELECT DISTINCT project_id FROM approvals WHERE status = 'pending'").all() as { project_id: number }[]).map((r) => r.project_id),
  );
  const pending = pendingCount();
  const lessons = activeLessons({ includeDemo: true });
  const events = maskEvents(
    db()
      .prepare("SELECT e.*, p.title FROM events e LEFT JOIN projects p ON p.id = e.project_id ORDER BY e.id DESC LIMIT 8")
      .all() as (EventRow & { title: string | null })[],
  );
  const active = projects.filter((p) => !["continued", "killed", "rejected"].includes(p.stage)).length;
  const hasDemo = projects.some((p) => p.demo);
  const hasSimulated = !!db().prepare("SELECT 1 FROM metrics WHERE source = 'simulated' LIMIT 1").get();
  const lastDaily = db().prepare("SELECT message FROM events WHERE kind = 'daily' ORDER BY id DESC LIMIT 1").get() as { message: string } | undefined;
  const modes = modeComparison();
  const modeSetting = s.approvalMode === "alternate" ? "2つのモードに交互に割り当て" : MODE_LABEL[s.approvalMode];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-xl font-bold">AIが自動でプロダクトを作る実験</h1>
          <p className="text-sm text-ink-2">
            AIがアイデアを考え、紹介ページ（LP）を作り、集まった反応を見て「続ける・改善・撤退」を判断します。
            あなたは要所で承認するだけです。このページでは、いま各案件がどこまで進んでいるかが分かります。
          </p>
        </div>
        <KillSwitch active={s.killSwitch} />
      </div>

      {s.killSwitch && (
        <div className="card border-l-4 p-3 text-sm" style={{ borderLeftColor: "var(--critical)" }}>
          <span style={{ color: "var(--critical)" }}>■</span> 緊急停止中です。AIの呼び出しはすべて止まっています。
        </div>
      )}

      {pending > 0 && (
        <Link href="/approvals" className="card flex items-center justify-between gap-3 border-l-4 p-4 hover:bg-surface-2" style={{ borderLeftColor: "var(--accent)" }}>
          <div>
            <div className="font-bold">あなたの承認待ちが {pending}件 あります</div>
            <div className="text-sm text-ink-2">AIはここで止まって待っています。内容を見て、承認・修正指示・却下を選んでください。</div>
          </div>
          <span className="shrink-0 text-sm text-accent">確認する →</span>
        </Link>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <div className="text-xs text-muted">今月のAI費用</div>
          <div className="num mt-1 text-2xl font-bold">{Math.round(aiJpy).toLocaleString("ja-JP")}円</div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="AI予算の消化率">
            <div className="h-full rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio >= 1 ? "var(--critical)" : ratio >= 0.8 ? "var(--warning)" : "var(--accent)" }} />
          </div>
          <div className="num mt-1 text-xs text-ink-2">
            上限 {s.monthlyBudgetJpy.toLocaleString("ja-JP")}円 の {pct(ratio)}（製品 {Math.round(spend.loop * s.usdJpy)}円・テスト {Math.round(spend.eval * s.usdJpy)}円）
          </div>
        </div>
        <Stat
          label="今月の広告費"
          value={`${monthAdSpendJpy().toLocaleString("ja-JP")}円`}
          sub={`1案件の上限 ${s.adBudgetPerProjectJpy.toLocaleString("ja-JP")}円${hasSimulated ? "・シミュレーションの架空の金額を含む" : ""}`}
        />
        <Stat label="進行中の案件" value={active} sub={`全${projects.length}件`} />
        <Stat label="使っているAI" value={<span className="text-lg">{getModel(s.loopModel).label}</span>} sub={<Link href="/settings" className="underline">設定で変更</Link>} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DailyCard
          enabled={s.dailyEnabled}
          hour={s.dailyHour}
          lastRun={s.lastDailyRun}
          lastMessage={lastDaily?.message ?? null}
          count={s.dailyIdeaCount}
          keep={s.dailyKeep}
          modeLabel={modeSetting}
        />
        <IdeaForm modelLabel={getModel(s.loopModel).label} />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">案件の進み具合</h2>
          <DemoButtons hasDemo={hasDemo} />
        </div>
        {projects.length === 0 ? (
          <div className="card p-6 text-sm text-ink-2">
            まだ案件がありません。上の「アイデアを出す」でAIに考えさせるか、「デモ案件を入れる」で流れを確認できます。
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {COLUMNS.map((col) => {
              const items = projects.filter((p) => col.stages.includes(p.stage));
              return (
                <div key={col.title} className="space-y-2 rounded-xl bg-surface-2 p-2">
                  <div className="px-1">
                    <div className="text-sm font-bold">{col.title} <span className="num font-normal text-muted">{items.length}</span></div>
                    <div className="text-xs text-muted">{col.who}</div>
                  </div>
                  {items.map((p) => <ProjectCard key={p.id} p={p} pending={pendingByProject.has(p.id)} target={s.targetSignupRate} />)}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-bold">「毎回承認」と「自動で進める」の比較</h2>
        <p className="text-xs text-muted">
          どこまでAIに任せてよいかを確かめるための比較です（デモ案件は含みません）。件数が少ないうちは差が偶然の可能性が高いので、参考程度に見てください。
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted">
              <tr className="border-b border-line">
                <th className="px-3 py-2">モード</th>
                <th className="px-3 py-2 text-right">案件数</th>
                <th className="px-3 py-2 text-right">人の承認（1案件あたり）</th>
                <th className="px-3 py-2 text-right">LPの改善</th>
                <th className="px-3 py-2 text-right">チェックで問題</th>
                <th className="px-3 py-2 text-right">登録率</th>
                <th className="px-3 py-2 text-right">継続 / 撤退</th>
                <th className="px-3 py-2 text-right">AI費用</th>
              </tr>
            </thead>
            <tbody>
              {modes.map((m) => (
                <tr key={m.mode} className="num border-b border-line last:border-0">
                  <td className="px-3 py-2 whitespace-nowrap">{MODE_LABEL[m.mode]}</td>
                  <td className="px-3 py-2 text-right">{m.projects}</td>
                  <td className="px-3 py-2 text-right">{m.humanApprovals}回（{m.approvalsPerProject.toFixed(1)}）</td>
                  <td className="px-3 py-2 text-right">{m.improvements}回</td>
                  <td className="px-3 py-2 text-right">{m.reviewIssues}件</td>
                  <td className="px-3 py-2 text-right">{m.rate === null ? "—" : pct(m.rate, 1)}</td>
                  <td className="px-3 py-2 text-right">{m.continued} / {m.killed}</td>
                  <td className="px-3 py-2 text-right">{yen(m.costUsd, s.usdJpy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-2">
          <h2 className="font-bold">AIの教訓メモ</h2>
          <p className="text-xs text-muted">終わった案件からAIが学んだこと。次のアイデア出しで参照されます（デモの教訓は参照されません）。</p>
          <div className="card divide-y divide-line text-sm">
            {lessons.length ? lessons.map((l) => (
              <div key={l.id} className="p-3">
                {l.demo ? <span className="mr-2 rounded border border-line px-1 text-[10px] text-muted" title="デモの教訓はAIへの入力に使われません">デモ</span> : null}
                {l.text}
                {l.project_id && <Link href={`/projects/${l.project_id}`} className="ml-2 text-xs text-accent underline">案件</Link>}
              </div>
            )) : <div className="p-3 text-ink-2">まだありません。</div>}
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="font-bold">最近の動き</h2>
          <p className="text-xs text-muted">AIとあなたが何をしたかの記録です。</p>
          <div className="card divide-y divide-line text-sm">
            {events.length ? events.map((e) => (
              <div key={e.id} className="flex gap-3 p-3">
                <span className="num shrink-0 text-xs text-muted">{e.at.slice(5, 16)}</span>
                <span className="shrink-0 text-xs font-medium" style={{ color: e.actor === "ai" ? "var(--accent)" : "var(--text-2)" }}>{ACTOR[e.actor]}</span>
                <span className="min-w-0">
                  {e.title && e.project_id && <Link href={`/projects/${e.project_id}`} className="mr-1 text-accent underline">{e.title}</Link>}
                  {e.message}
                </span>
              </div>
            )) : <div className="p-3 text-ink-2">まだありません。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProjectCard({ p, pending, target }: { p: ProjectRow; pending: boolean; target: number }) {
  const t = ["live", "deciding", "continued", "killed"].includes(p.stage) ? projectTotals(p.id) : null;
  const result = p.stage === "continued" ? { c: "var(--good)", i: "✓" } : p.stage === "killed" ? { c: "var(--critical)", i: "✕" } : p.stage === "rejected" ? { c: "var(--muted)", i: "–" } : null;
  return (
    <Link href={`/projects/${p.id}`} className="card block space-y-1 p-3 hover:border-accent">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{p.title}</div>
        <span className="flex shrink-0 gap-1">
          <span className="rounded border border-line px-1 text-[10px] text-ink-2">{p.mode === "auto" ? "自動" : "承認"}</span>
          {p.demo ? <span className="rounded border border-line px-1 text-[10px] text-muted">デモ</span> : null}
        </span>
      </div>
      <div className="line-clamp-2 text-xs text-ink-2">{p.target}</div>
      {t && (
        <div className="num text-xs text-ink-2">
          訪問 {t.visits} / 登録 {t.signups}（<span style={{ color: t.rate >= target ? "var(--good)" : "var(--text-2)" }}>{pct(t.rate, 1)}</span>）
        </div>
      )}
      {p.improve_count > 0 && <div className="text-xs text-ink-2">LP改善 {p.improve_count}回（第{p.lp_version}版）</div>}
      {pending && <div className="text-xs font-medium text-accent">● あなたの承認待ち</div>}
      {result && <div className="text-xs font-medium" style={{ color: result.c }}>{result.i} {STAGE_LABEL[p.stage]}</div>}
    </Link>
  );
}
