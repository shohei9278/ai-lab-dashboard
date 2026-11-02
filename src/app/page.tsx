import Link from "next/link";
import { db, getSettings, type ProjectRow, type Stage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { CONV, MODE_LABEL, STAGE_LABEL, activeLessons, modeComparison, projectTotals, targetRate } from "@/lib/loop";
import { WAIT_LABEL, overview, waitingItems } from "@/lib/overview";
import { SignupTrend } from "@/components/SignupTrend";
import { pct, yen } from "@/lib/format";
import { KillSwitch } from "@/components/KillSwitch";
import { DemoButtons, IdeaForm } from "@/components/IdeaForm";
import { DailyCard } from "@/components/DailyCard";
import { Stat } from "@/components/ui";

export const dynamic = "force-dynamic";

const COLUMNS: { stages: Stage[]; title: string; who: string }[] = [
  { stages: ["idea"], title: "① アイデア", who: "AIが提案 → 毎回承認モードではあなたが採用を判断" },
  { stages: ["lp"], title: "② LP作成", who: "AIが紹介ページを作ってチェック → あなたが公開を判断" },
  { stages: ["live"], title: "③ 集客中", who: "公開して反応を集める（自動モードはAIがLPの改善も行う）" },
  { stages: ["deciding"], title: "④ 判断", who: "AIが続ける・改善・撤退を提案" },
  { stages: ["continued", "killed", "rejected"], title: "⑤ 結果", who: "終わった案件。AIが教訓を残す" },
];

const ACTOR = { ai: "AI", human: "あなた", system: "システム" } as const;

export default function Home() {
  const s = getSettings();
  const projects = db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  const pendingByProject = new Set(
    (db().prepare("SELECT DISTINCT project_id FROM approvals WHERE status = 'pending'").all() as { project_id: number }[]).map((r) => r.project_id),
  );
  const lessons = activeLessons({ includeDemo: true });
  const hasDemo = projects.some((p) => p.demo);
  const hasSimulated = !!db().prepare("SELECT 1 FROM metrics WHERE source = 'simulated' LIMIT 1").get();
  const lastDaily = db().prepare("SELECT message FROM events WHERE kind = 'daily' ORDER BY id DESC LIMIT 1").get() as { message: string } | undefined;
  const modes = modeComparison();
  const modeSetting = s.approvalMode === "alternate"
    ? "2つのモードに交互に割り当て"
    : s.approvalMode === "confidence"
      ? `AIの自信が${Math.round(s.autoConfidence * 100)}%以上なら自動`
      : MODE_LABEL[s.approvalMode];

  const o = overview();
  const waiting = waitingItems();
  const waitingAt = (stage: Stage) => waiting.filter((w) => w.stage === stage).length;
  const diff = o.todaySignups - o.yesterdaySignups;
  const budgetRatio = s.monthlyBudgetJpy ? o.aiJpy / s.monthlyBudgetJpy : 0;
  const status = s.killSwitch
    ? { c: "var(--critical)", t: "緊急停止中" }
    : s.dailyEnabled
      ? { c: "var(--good)", t: `稼働中（毎日${s.dailyHour}時以降に自動実行）` }
      : { c: "var(--muted)", t: "毎日の自動実行はオフ" };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl space-y-1">
          <h1 className="text-xl font-bold">AIが自動でプロダクトを作る実験</h1>
          <p className="text-sm text-ink-2">
            AIがアイデアを考え、紹介ページ（LP）を作り、集まった反応を見て「続ける・改善・撤退」を判断します。あなたは要所で承認するだけです。
          </p>
          <p className="flex items-center gap-1.5 text-xs text-ink-2">
            <span aria-hidden style={{ color: status.c }}>●</span>{status.t}
          </p>
        </div>
        <KillSwitch active={s.killSwitch} />
      </div>

      {s.killSwitch && (
        <div className="card border-l-4 p-3 text-sm" style={{ borderLeftColor: "var(--critical)" }}>
          <span style={{ color: "var(--critical)" }}>■</span> 緊急停止中です。AIの呼び出しはすべて止まっています。
        </div>
      )}

      {/* 大きな数字（デモを除いた実データ） */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href="#waiting"
          className="card block p-4 hover:bg-surface-2"
          style={waiting.length ? { borderColor: "var(--accent)", boxShadow: "inset 4px 0 0 var(--accent)" } : undefined}
        >
          <div className="text-xs text-muted">あなた待ちで止まっている</div>
          <div className="num mt-1 text-2xl font-bold" style={{ color: waiting.length ? "var(--accent)" : undefined }}>{waiting.length}件</div>
          <div className="mt-1 text-xs text-ink-2">{waiting.length ? "下の一覧から案件を開けます ↓" : "止まっているものはありません"}</div>
        </a>
        <Stat
          label="今日の登録・利用"
          value={`${o.todaySignups}人`}
          sub={<>前日比 {diff >= 0 ? "+" : ""}{diff}人・累計 {o.totalSignups}人</>}
        />
        <Stat label="集客中のLP" value={`${o.liveReal}件`} sub={`これまでに作った案件 ${o.projectsReal}件`} />
        <Stat label="今月AIが自動で処理した数" value={`${o.aiCallsMonth}回`} sub={`今日 ${o.aiCallsToday}回・アイデア出し、LP作成、判断など`} />
      </div>

      {/* 止まっているもの */}
      <section id="waiting" className="card scroll-mt-4 p-4" style={waiting.length ? { borderColor: "var(--accent)" } : undefined}>
        <Head title="あなた待ちで止まっているもの" note="古い順です。行を押すと案件の画面に移動して、そこで承認・修正指示・却下ができます。" />
        {waiting.length === 0 ? (
          <p className="text-sm text-ink-2">いまは何も止まっていません。AIが自動で進めています。</p>
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((w) => {
              const label = w.kind === "stuck"
                ? { title: "AIの作業が途中で停止", action: "作り直しを指示する" }
                : WAIT_LABEL[w.kind];
              const urgent = w.daysLeft !== null && w.daysLeft <= 1;
              return (
                <li key={w.key}>
                  <Link href={`/projects/${w.projectId}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2 sm:flex-nowrap">
                    <span
                      className="w-36 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium"
                      style={w.kind === "stuck"
                        ? { background: "var(--surface-2)", color: "var(--critical)" }
                        : { background: "var(--surface-2)", color: "var(--accent)" }}
                    >
                      {w.kind === "stuck" ? "! " : ""}{label.title}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{w.title}</span>
                      {w.demo && <span className="ml-2 rounded border border-line px-1 text-[10px] text-muted">デモ</span>}
                      <span className="block text-xs text-ink-2">{label.action}</span>
                    </span>
                    <span className="num shrink-0 text-xs text-ink-2">
                      {waitLabel(w.daysWaiting)}
                      {w.daysLeft !== null && (
                        <span className="ml-2" style={{ color: urgent ? "var(--critical)" : undefined }}>
                          {urgent ? "▲ " : ""}あと{w.daysLeft}日で自動見送り
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-sm text-accent group-hover:underline">開く →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 推移と処理ログ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-2">
          <Head
            title="登録・利用の推移（累計）"
            note={`実データのみ（デモを除く）${o.trendSimulated ? "。シミュレーションの架空の数字を含みます" : ""}。点に合わせると訪問数も見られます。`}
          />
          {o.trend.length ? (
            <SignupTrend data={o.trend} />
          ) : (
            <p className="py-10 text-center text-sm text-ink-2">まだ集客の数字がありません。LPを公開すると、ここに推移が出ます。</p>
          )}
        </section>
        <section className="card p-4">
          <Head title="AIの処理ログ" note="AIとあなたが何をしたかの最新の記録です。" />
          <ol className="space-y-2">
            {o.events.map((e) => (
              <li key={e.id} className="text-xs">
                <div className="flex gap-2 text-muted">
                  <span className="num">{e.at.slice(5, 16)}</span>
                  <span className="font-medium" style={{ color: e.actor === "ai" ? "var(--accent)" : "var(--text-2)" }}>{ACTOR[e.actor]}</span>
                  {e.title && e.project_id ? (
                    <Link href={`/projects/${e.project_id}`} className="truncate text-accent hover:underline">{e.title}</Link>
                  ) : null}
                </div>
                <p className="line-clamp-1 text-ink-2" title={e.message}>{e.message}</p>
              </li>
            ))}
            {!o.events.length && <li className="text-ink-2">まだありません。</li>}
          </ol>
        </section>
      </div>

      {/* 自動化のループ */}
      <section className="card p-4">
        <Head title="AIのプロダクト自動化ループ" note="各段階にいる案件の数です（デモを含む）。「あなた待ち」があると、AIはそこで止まっています。" />
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((f, i) => {
            const n = o.stageCount(f.stages);
            const w = waitingAt(f.stages[0]);
            return (
              <li key={f.title} className="relative">
                <a
                  href={w ? "#waiting" : "#board"}
                  className="block h-full rounded-xl border p-3 hover:bg-surface-2"
                  style={{ borderColor: w ? "var(--accent)" : "var(--border)" }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-bold">{i + 1}. {f.title}</span>
                    <span className="num text-xl font-bold">{n}<span className="text-xs font-normal text-muted">件</span></span>
                  </div>
                  <div className="mt-1 text-xs text-ink-2">{f.who}</div>
                  <div className="mt-2 text-xs font-medium" style={{ color: w ? "var(--accent)" : "var(--muted)" }}>
                    {w ? `● あなた待ち ${w}件 →` : "○ あなた待ちなし"}
                  </div>
                </a>
                {i < FLOW.length - 1 && <span aria-hidden className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-muted lg:block">→</span>}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-ink-2">
          ↺ 判断で「改善」になると 2. LP作成 に戻ります。終わった案件：継続 {o.stageCount(["continued"])}件・撤退 {o.stageCount(["killed"])}件・見送り {o.stageCount(["rejected"])}件
        </p>
      </section>

      {/* 下段の3つ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-4">
          <Head title="集客中" note={`目標は登録率 ${pct(s.targetSignupRate, 1)}・ツールの利用率 ${pct(s.targetUseRate)}・判断の目安は訪問${s.judgeMinVisits}人`} />
          {o.live.length ? (
            <ul className="space-y-3 text-sm">
              {o.live.map(({ p, t }) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex justify-between gap-2 hover:underline">
                    <span className="truncate">{p.title}{p.demo ? <span className="ml-1 text-[10px] text-muted">デモ</span> : null}</span>
                    <span className="num shrink-0" style={{ color: t.rate >= targetRate(p.kind, s) ? "var(--good)" : "var(--text-2)" }}>{CONV[p.kind].rate} {pct(t.rate, 1)}</span>
                  </Link>
                  <Meter value={t.visits / s.judgeMinVisits} />
                  <div className="num text-xs text-muted">訪問 {t.visits}/{s.judgeMinVisits}人・{CONV[p.kind].noun} {t.signups}人</div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">集客中のLPはありません。</p>
          )}
        </section>
        <section className="card p-4">
          <Head title="AIによるLPの改善" note={`自動モードでは、承認なしで${s.maxAutoImprove}回まで改善します`} />
          {o.improving.length ? (
            <ul className="space-y-3 text-sm">
              {o.improving.map(({ p, note }) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex justify-between gap-2 hover:underline">
                    <span className="truncate">{p.title}{p.demo ? <span className="ml-1 text-[10px] text-muted">デモ</span> : null}</span>
                    <span className="num shrink-0 text-ink-2">第{p.lp_version}版</span>
                  </Link>
                  <Meter value={p.improve_count / Math.max(1, s.maxAutoImprove)} />
                  {note && <div className="line-clamp-1 text-xs text-muted">{note}</div>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">まだ改善した案件はありません。</p>
          )}
        </section>
        <section className="card p-4">
          <Head title="今月のお金" note="売上ではなく、この実験にかかった費用です。" />
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between"><span>AI費用</span><span className="num">{Math.round(o.aiJpy).toLocaleString("ja-JP")}円</span></div>
              <Meter value={budgetRatio} warn />
              <div className="num text-xs text-muted">上限 {s.monthlyBudgetJpy.toLocaleString("ja-JP")}円 の {pct(budgetRatio)}</div>
            </div>
            <div>
              <div className="flex justify-between"><span>広告費</span><span className="num">{o.adJpy.toLocaleString("ja-JP")}円</span></div>
              <div className="num text-xs text-muted">1案件の上限 {s.adBudgetPerProjectJpy.toLocaleString("ja-JP")}円{hasSimulated ? "・シミュレーションの架空の金額を含む" : ""}</div>
            </div>
            <div className="border-t border-line pt-2 text-xs text-ink-2">
              使っているAI：{getModel(s.loopModel).label}（<Link href="/settings" className="underline">設定で変更</Link>）
            </div>
          </div>
        </section>
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

      <section id="board" className="scroll-mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold">案件の一覧</h2>
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
                  {items.map((p) => <ProjectCard key={p.id} p={p} pending={pendingByProject.has(p.id)} target={targetRate(p.kind, s)} />)}
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
                <th className="px-3 py-2 text-right">成果の率</th>
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

      <div>
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
          {p.kind === "tool" && <span className="rounded border border-line px-1 text-[10px] text-ink-2">ツール</span>}
          <span className="rounded border border-line px-1 text-[10px] text-ink-2">{p.mode === "auto" ? "自動" : "承認"}</span>
          {p.demo ? <span className="rounded border border-line px-1 text-[10px] text-muted">デモ</span> : null}
        </span>
      </div>
      <div className="line-clamp-2 text-xs text-ink-2">{p.target}</div>
      {t && (
        <div className="num text-xs text-ink-2">
          訪問 {t.visits} / {CONV[p.kind].noun} {t.signups}（<span style={{ color: t.rate >= target ? "var(--good)" : "var(--text-2)" }}>{pct(t.rate, 1)}</span>）
        </div>
      )}
      {p.improve_count > 0 && <div className="text-xs text-ink-2">LP改善 {p.improve_count}回（第{p.lp_version}版）</div>}
      {pending && <div className="text-xs font-medium text-accent">● あなたの承認待ち</div>}
      {result && <div className="text-xs font-medium" style={{ color: result.c }}>{result.i} {STAGE_LABEL[p.stage]}</div>}
    </Link>
  );
}

const FLOW: { stages: Stage[]; title: string; who: string }[] = [
  { stages: ["idea"], title: "アイデア", who: "3社のAIが出し方（LP・ツール）も選んで採点。毎回承認モードはあなたが採用を判断" },
  { stages: ["lp"], title: "作成", who: "AIがLPやツールを作ってチェック。公開はあなたが判断" },
  { stages: ["live"], title: "集客中", who: "登録や利用を集める。自動モードはAIがLPの改善も" },
  { stages: ["deciding"], title: "判断", who: "AIが続ける・改善・撤退を提案し、あなたが決める" },
];

function waitLabel(days: number): string {
  if (days < 1 / 24) return "さっきから待機";
  if (days < 1) return `${Math.floor(days * 24)}時間前から待機`;
  return `${Math.floor(days)}日前から待機`;
}

function Head({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="font-bold">{title}</h2>
      {note && <p className="text-xs text-muted">{note}</p>}
    </div>
  );
}

function Meter({ value, warn }: { value: number; warn?: boolean }) {
  const v = Math.max(0, Math.min(1, value));
  const color = warn && value >= 1 ? "var(--critical)" : warn && value >= 0.8 ? "var(--warning)" : "var(--accent)";
  return (
    <div className="my-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={Math.round(v * 100)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${v * 100}%`, background: color }} />
    </div>
  );
}
