import Link from "next/link";
import { db, getSettings, type ProjectRow, type Stage } from "@/lib/db";
import { getModel } from "@/lib/models";
import { CONV, MODE_LABEL, STAGE_LABEL, autoPublishStats, projectTotals, targetRate } from "@/lib/loop";
import { WAIT_LABEL, overview, waitingItems } from "@/lib/overview";
import { SignupTrend } from "@/components/SignupTrend";
import { costEfficiency } from "@/lib/cost";
import { jstDateTime, pct } from "@/lib/format";
import { KillSwitch } from "@/components/KillSwitch";
import { IdeaForm } from "@/components/IdeaForm";
import { DailyCard } from "@/components/DailyCard";
import { Stat } from "@/components/ui";
import { AUTO_PLATFORMS, autoPlatforms } from "@/lib/snsApi";
import { budgetState } from "@/lib/budget";

export const dynamic = "force-dynamic";

const COLUMNS: { stages: Stage[]; title: string; who: string }[] = [
  { stages: ["idea"], title: "① アイデア", who: "3社のAIが出して採点し、上位を進める" },
  { stages: ["lp"], title: "② 作成", who: "AIがLPやツールを作ってチェック。通れば自動で公開" },
  { stages: ["live"], title: "③ 公開・集客中", who: "AIがSNSに投稿して人を呼ぶ。届いていなければ集客を見直し、「続ける」になった案件は育てる" },
  { stages: ["deciding"], title: "④ 判断", who: "AIが続ける・改善・集客の見直し・撤退を決める" },
  { stages: ["continued", "killed", "rejected"], title: "⑤ 結果", who: "終わった案件。AIが教訓を残す" },
];

const ACTOR = { ai: "AI", human: "あなた", system: "システム" } as const;

export default function Home() {
  const s = getSettings();
  const projects = db().prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as ProjectRow[];
  const pendingByProject = new Set(
    (db().prepare("SELECT DISTINCT project_id FROM approvals WHERE status = 'pending'").all() as { project_id: number }[]).map((r) => r.project_id),
  );
  const hasSimulated = !!db().prepare("SELECT 1 FROM metrics WHERE source = 'simulated' LIMIT 1").get();
  const xPosts = db().prepare(
    `SELECT s.text, s.platform, s.posted_at, s.post_url, s.visits, s.conversions, p.id AS project_id, p.title, p.kind
     FROM sns_posts s JOIN projects p ON p.id = s.project_id WHERE s.status = 'posted' ORDER BY s.posted_at DESC LIMIT 4`,
  ).all() as { text: string; platform: string; posted_at: string; post_url: string | null; visits: number; conversions: number; project_id: number; title: string; kind: ProjectRow["kind"] }[];
  const xToday = (db().prepare("SELECT COUNT(*) AS n FROM sns_posts WHERE status = 'posted' AND author = 'ai' AND post_url IS NOT NULL AND posted_at >= datetime('now', '-24 hours')").get() as { n: number }).n;
  const snsOn = autoPlatforms().map((k) => AUTO_PLATFORMS[k].label);
  const xReady = snsOn.length > 0;
  // 場所ごとの最後の自動投稿が失敗していたら出す
  const xLastError = db().prepare(
    `SELECT c.at, c.purpose || ': ' || c.error AS error FROM ai_calls c
     WHERE c.model_id IN ('x-api', 'threads-api', 'bluesky-api') AND c.error IS NOT NULL AND c.id = (SELECT MAX(id) FROM ai_calls d WHERE d.model_id = c.model_id)
     ORDER BY c.id DESC LIMIT 1`,
  ).get() as { at: string; error: string } | undefined;
  const lastDaily = db().prepare("SELECT message FROM events WHERE kind = 'daily' ORDER BY id DESC LIMIT 1").get() as { message: string } | undefined;
  const modeSetting = s.approvalMode === "alternate"
    ? "2つのモードに交互に割り当て"
    : s.approvalMode === "confidence"
      ? `AIの自信が${Math.round(s.autoConfidence * 100)}%以上なら自動`
      : MODE_LABEL[s.approvalMode];

  const o = overview();
  const waiting = waitingItems();
  const autoStats = autoPublishStats();
  const waitingAt = (stage: Stage) => waiting.filter((w) => w.stage === stage).length;
  const diff = o.todaySignups - o.yesterdaySignups;
  const budgetRatio = s.monthlyBudgetJpy ? o.aiJpy / s.monthlyBudgetJpy : 0;
  const bud = budgetState();
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
            {s.fullAuto && s.approvalMode === "auto"
              ? "AIがアイデアを考え、事前登録のページや動くツールを作って公開し、Xで人を呼び、集まった反応を見て「続ける・改善・撤退」まで決めます。あなたは、AIだけで公開したものをあとから確認します。"
              : "AIがアイデアを考え、事前登録のページや動くツールを作って公開し、集まった反応を見て「続ける・改善・撤退」を判断します。設定によって、要所であなたの承認を待ちます。"}
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

      {/* 大きな数字 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <a
          href="#waiting"
          className="card block p-4 hover:bg-surface-2"
          style={waiting.length ? { borderColor: "var(--accent)", boxShadow: "inset 4px 0 0 var(--accent)" } : undefined}
        >
          <div className="text-xs text-muted">あなたの確認・対応</div>
          <div className="num mt-1 text-2xl font-bold" style={{ color: waiting.length ? "var(--accent)" : undefined }}>{waiting.length}件</div>
          <div className="mt-1 text-xs text-ink-2">{waiting.length ? "下の一覧から案件を開けます ↓" : "確認することはありません"}</div>
        </a>
        <Stat
          label="今日の登録・利用"
          value={`${o.todaySignups}人`}
          sub={<>前日比 {diff >= 0 ? "+" : ""}{diff}人・累計 {o.totalSignups}人</>}
        />
        <Stat label="公開・集客中" value={`${o.liveReal}件`} sub={`これまでに作った案件 ${o.projectsReal}件`} />
        <Stat label="今月AIが自動で処理した数" value={`${o.aiCallsMonth}回`} sub={`今日 ${o.aiCallsToday}回・アイデア出し、ページ作成、投稿、判断など`} />
      </div>

      {/* 止まっているもの */}
      <section id="waiting" className="card scroll-mt-4 p-4" style={waiting.length ? { borderColor: "var(--accent)" } : undefined}>
        <Head title="あなたの確認・対応" note="AIだけで公開したものの確認と、AIが人に回したもの（チェックで問題が残った・上限に達したなど）です。古い順で、行を押すと案件の画面に移動します。" />
        {waiting.length === 0 ? (
          <p className="text-sm text-ink-2">いまは確認することはありません。AIが自動で進めています。</p>
        ) : (
          <ul className="divide-y divide-line">
            {waiting.map((w) => {
              const label = w.kind === "stuck"
                ? { title: "AIの作業が途中で停止", action: "作り直しを指示する" }
                : w.kind === "notify"
                  ? { title: "登録者への連絡", action: "撤退を伝えて、メールアドレスを消す" }
                : w.kind === "comment"
                  ? { title: "SNSのコメント", action: "AIが書いた返信の案を見て、送るか決める" }
                : w.kind === "review"
                  ? { title: "AIだけで公開（確認）", action: "公開中のページを見て、問題ないか印を付ける（止まってはいません）" }
                  : WAIT_LABEL[w.kind];
              const urgent = w.daysLeft !== null && w.daysLeft <= 1;
              return (
                <li key={w.key}>
                  <Link href={w.kind === "comment" ? "/growth#comments" : `/projects/${w.projectId}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2 sm:flex-nowrap">
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
        {autoStats.published > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
            AIだけで公開したもの: {autoStats.published}件（あなたが確認済み {autoStats.reviewed}件・うち「出すべきでなかった」{autoStats.bad}件
            {autoStats.reviewed > 0 ? `＝${pct(autoStats.bad / autoStats.reviewed, 0)}` : ""}）
          </p>
        )}
      </section>

      {/* 推移と処理ログ */}
      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-4 lg:col-span-2">
          <Head
            title="登録・利用の推移（累計）"
            note={`${o.trendSimulated ? "シミュレーションの架空の数字を含みます。" : ""}点に合わせると訪問数も見られます。`}
          />
          {o.trend.length ? (
            <SignupTrend data={o.trend} />
          ) : (
            <p className="py-10 text-center text-sm text-ink-2">まだ集客の数字がありません。LPやツールを公開すると、ここに推移が出ます。</p>
          )}
        </section>
        <section className="card p-4">
          <Head title="AIの処理ログ" note="AIとあなたが何をしたかの最新の記録です。" />
          <ol className="space-y-2">
            {o.events.map((e) => (
              <li key={e.id} className="text-xs">
                <div className="flex gap-2 text-muted">
                  <span className="num">{jstDateTime(e.at)}</span>
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
        <Head title="AIのプロダクト自動化ループ" note="各段階にいる案件の数です。「あなたの確認」がある段階は、行を押すと一覧に移動します。" />
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
                    {w ? `● あなたの確認 ${w}件 →` : "○ 確認なし"}
                  </div>
                </a>
                {i < FLOW.length - 1 && <span aria-hidden className="absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 text-muted lg:block">→</span>}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-ink-2">
          ↺ 判断で「改善」になると 2. 作成 に戻り、「集客の見直し」「続ける（育てる）」では公開したまま次の実験に進みます。終わった案件：継続 {o.stageCount(["continued"])}件・撤退 {o.stageCount(["killed"])}件・見送り {o.stageCount(["rejected"])}件
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
            <p className="text-sm text-ink-2">公開中の案件はありません。</p>
          )}
        </section>
        <section className="card p-4">
          <Head
            title="SNSでの集客"
            note={!xReady ? "SNSのキーが未設定です（docs/SETUP-SNS.md）" : s.autoPost ? `AIが ${snsOn.join("・")} に自動で投稿中（直近24時間 ${xToday}件・場所ごとに1日${s.autoPostPerDay}件まで）` : "自動投稿はオフです（設定でオンにできます）"}
          />
          {xLastError && (
            <p className="mb-3 rounded-lg p-2 text-xs" style={{ background: "var(--surface-2)", color: "var(--critical)" }}>
              ! 最後の自動投稿が失敗しました（{jstDateTime(xLastError.at)}）: {xLastError.error}
              <span className="block text-ink-2">{/credits depleted/.test(xLastError.error) ? "X の Developer Console でクレジットを購入してください。" : ""}2時間ごとに試し直します。</span>
            </p>
          )}
          {xPosts.length ? (
            <ul className="space-y-3 text-sm">
              {xPosts.map((x) => (
                <li key={x.posted_at + x.project_id}>
                  <div className="flex justify-between gap-2 text-xs text-muted">
                    <Link href={`/projects/${x.project_id}`} className="truncate hover:underline">{x.title}<span className="ml-1 text-muted">・{x.platform === "x" ? "X" : x.platform === "threads" ? "Threads" : x.platform === "bluesky" ? "Bluesky" : x.platform}</span></Link>
                    <span className="num shrink-0">{jstDateTime(x.posted_at)}</span>
                  </div>
                  <p className="line-clamp-2 text-xs text-ink-2">{x.text}</p>
                  <div className="num text-xs text-muted">
                    訪問 {x.visits}人・{CONV[x.kind].noun} {x.conversions}人
                    {x.post_url && <a href={x.post_url} target="_blank" rel="noreferrer" className="ml-2 text-accent underline">投稿 ↗</a>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-2">まだ投稿はありません。</p>
          )}
          <Link href="/growth" className="mt-3 block text-xs text-accent underline">SNSの管理を開く →</Link>
          {o.improving.length > 0 && (
            <p className="mt-3 border-t border-line pt-2 text-xs text-ink-2">
              AIが改善した案件: {o.improving.map(({ p }) => `${p.title}（第${p.lp_version}版）`).join("・")}
            </p>
          )}
        </section>
        <section className="card p-4">
          <Head title="今月のお金" note="売上ではなく、この実験にかかった費用です。" />
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between"><span>AI費用</span><span className="num">{Math.round(o.aiJpy).toLocaleString("ja-JP")}円</span></div>
              <Meter value={budgetRatio} warn />
              <div className="num text-xs text-muted">上限 {s.monthlyBudgetJpy.toLocaleString("ja-JP")}円 の {pct(budgetRatio)}・月末の見込み 約{Math.round(bud.projected).toLocaleString("ja-JP")}円</div>
              <div className="mt-1 text-xs" style={{ color: bud.creativeOk && bud.newToday > 0 ? "var(--text-2)" : "var(--warning)" }}>
                {!bud.creativeOk
                  ? "予算の残りが少ないため、新しい案件は休み、SNSの投稿と判断だけ続けています"
                  : `新しい案件: 今日はあと${bud.newToday}件まで（1件 約${Math.round(bud.perProject)}円・予算のペースに合わせて自動で調整）`}
              </div>
            </div>
            <div>
              <div className="flex justify-between"><span>広告費</span><span className="num">{o.adJpy.toLocaleString("ja-JP")}円</span></div>
              <div className="num text-xs text-muted">1案件の上限 {s.adBudgetPerProjectJpy.toLocaleString("ja-JP")}円{hasSimulated ? "・シミュレーションの架空の金額を含む" : ""}</div>
            </div>
            {(() => {
              const c = costEfficiency().all;
              return (
                <div className="text-xs text-ink-2">
                  これまでの成果1件あたり: <span className="num font-medium text-ink">{c.perConversion === null ? "—" : `${Math.round(c.perConversion).toLocaleString("ja-JP")}円`}</span>
                  <span className="text-muted">（実案件のAI費用＋広告費 ÷ 登録・利用 {c.conversions}件。<Link href="/lab" className="underline">内訳</Link>）</span>
                </div>
              );
            })()}
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
        </div>
        {projects.length === 0 ? (
          <div className="card p-6 text-sm text-ink-2">
            まだ案件がありません。上の「アイデアを出す」でAIに考えさせてください。
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

      <p className="text-sm text-ink-2">
        AIのランキング・全自動の成績・教訓は <Link href="/lab" className="text-accent underline">実験結果</Link> にまとめています。
      </p>
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
          <span className="rounded border border-line px-1 text-[10px] text-ink-2">{p.auto_published ? "AIだけで公開" : p.mode === "auto" ? "自動" : "承認"}</span>
          {!!p.growth_phase && <span className="rounded border border-line px-1 text-[10px]" style={{ color: "var(--good)" }}>育成中</span>}
          {p.demo ? <span className="rounded border border-line px-1 text-[10px] text-muted">デモ</span> : null}
        </span>
      </div>
      <div className="line-clamp-2 text-xs text-ink-2">{p.target}</div>
      {t && (
        <div className="num text-xs text-ink-2">
          訪問 {t.visits} / {CONV[p.kind].noun} {t.signups}（<span style={{ color: t.rate >= target ? "var(--good)" : "var(--text-2)" }}>{pct(t.rate, 1)}</span>）
        </div>
      )}
      {p.improve_count > 0 && <div className="text-xs text-ink-2">改善 {p.improve_count}回（第{p.lp_version}版）</div>}
      {pending && <div className="text-xs font-medium text-accent">● あなたの判断待ち</div>}
      {!!p.auto_published && !p.human_review && <div className="text-xs font-medium text-accent">● あとから確認してください</div>}
      {result && <div className="text-xs font-medium" style={{ color: result.c }}>{result.i} {STAGE_LABEL[p.stage]}</div>}
    </Link>
  );
}

const FLOW: { stages: Stage[]; title: string; who: string }[] = [
  { stages: ["idea"], title: "アイデア", who: "3社のAIが、種類を問わずアイデアと「最初の届け方」を出し、採点して選ぶ" },
  { stages: ["lp"], title: "作成", who: "AIが事前登録のページや動くツールを作り、画面を撮ってチェック。通れば自動で公開" },
  { stages: ["live"], title: "公開・集客", who: "AIがSNSに投稿して人を呼ぶ。届いていなければ集客を見直す" },
  { stages: ["deciding"], title: "判断", who: "訪問がたまるか一定の日数がたつと、AIが続ける（育てる）・改善・集客の見直し・撤退を決める" },
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
