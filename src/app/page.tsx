import { isOwner } from "@/lib/viewer";
import Link from "next/link";
import { db, getSettings } from "@/lib/db";
import { getModel, modelInfo } from "@/lib/models";
import { autoPublishStats } from "@/lib/loop";
import { WAIT_LABEL, overview, waitingItems } from "@/lib/overview";
import { SignupTrend } from "@/components/SignupTrend";
import { costEfficiency } from "@/lib/cost";
import { jstDateTime, pct } from "@/lib/format";
import { ShowMore } from "@/components/ShowMore";
import { KillSwitch } from "@/components/KillSwitch";
import { Stat } from "@/components/ui";
import { budgetState } from "@/lib/budget";
import { unreviewedPostCount } from "@/lib/postStats";
import { officeSnapshot } from "@/lib/office";
import { OfficeView } from "./office/OfficeView";
import { liveSnapshot } from "@/lib/live";
import { OwnerActions } from "./office/OwnerActions";
import { adhocRunning } from "@/lib/adhoc";
import { members } from "@/lib/weekly";
import { ideaAuthors } from "@/lib/loop";
import { xConfigured } from "@/lib/xPost";

export const dynamic = "force-dynamic";

export default async function Home() {
  const s = getSettings();
  const hasSimulated = !!db().prepare("SELECT 1 FROM metrics WHERE source = 'simulated' LIMIT 1").get();
  // 場所ごとの最後の自動投稿が失敗していたら出す
  const xLastError = db().prepare(
    `SELECT c.at, c.purpose || ': ' || c.error AS error FROM ai_calls c
     WHERE c.model_id IN ('x-api', 'threads-api', 'bluesky-api') AND c.error IS NOT NULL AND c.id = (SELECT MAX(id) FROM ai_calls d WHERE d.model_id = c.model_id)
     ORDER BY c.id DESC LIMIT 1`,
  ).get() as { at: string; error: string } | undefined;
  const o = overview();
  const owner = await isOwner();
  const you = owner ? "あなた" : "運営者";
  const waiting = waitingItems();
  const autoStats = autoPublishStats();
  const unseenPosts = owner ? unreviewedPostCount() : 0;
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
          <h1 className="text-xl font-bold">運営ダッシュボード</h1>
          <p className="text-sm font-medium text-ink-2">AIが自動でプロダクトを作る実験</p>
          <p className="text-sm text-ink-2">
            Claude・GPT・Gemini の3社のAIを社員にした、小さなプロダクト会社の実験です。社員どうしでアイデアを出して採点し合い、事前登録のページや動くツールを作って公開し、SNSで人を呼び、反応を見て「続ける・改善・撤退」まで決めます。
            毎朝の朝会で今日やることを決め、週1回の定例会議で振り返ります。
            {s.fullAuto && s.approvalMode === "auto"
              ? `${you}は社長として、AIだけで出したものをあとから確認し、提案箱に返事をします。`
              : `要所では${you}（社長）の承認を待ち、提案箱の提案にも返事をします。`}
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
          <div className="text-xs text-muted">{you}の確認・対応</div>
          <div className="num mt-1 text-2xl font-bold" style={{ color: waiting.length ? "var(--accent)" : undefined }}>{waiting.length}件</div>
          <div className="mt-1 text-xs text-ink-2">{waiting.length ? "下の一覧から案件を開けます ↓" : "確認することはありません"}</div>
        </a>
        <Stat
          label="今日の登録・利用"
          value={`${o.todaySignups}人`}
          sub={<>前日比 {diff >= 0 ? "+" : ""}{diff}人・累計 {o.totalSignups}人</>}
        />
        <Stat label="公開中・集客中" value={`${o.liveReal}件`} sub={`これまでに作った案件 ${o.projectsReal}件`} />
        <Stat label="今月AIが自動で処理した数" value={`${o.aiCallsMonth}回`} sub={`今日 ${o.aiCallsToday}回・アイデア出し、ページ作成、投稿、判断など`} />
      </div>

      {/* オフィス（AIの社員のいまの様子）。来訪者・運営者とも、大きな数字のすぐ下に出す（専用のページは作らない） */}
      <section aria-labelledby="office-title" className="space-y-2">
        <h2 id="office-title" className="font-bold">AIの社員が働くオフィス</h2>
        <p className="text-sm text-ink-2">Claude・GPT・Gemini のロボットの社員が、いま何をしているかを部屋の位置で見せています。</p>
        {/* ライブ（AIの会話と処理のログ）は、もとは別の画面だったが、オフィスと同じ「いま何をしているか」を見せるものなので、オフィスの下にまとめた */}
        <OfficeView initial={officeSnapshot({ guest: !owner })} owner={owner} numbers={!owner} live={liveSnapshot({ guest: !owner })}
          controls={owner ? (
            <OwnerActions
              meeting={{ members: members().map((id) => ({ id, label: modelInfo(id).label, color: `var(--series-${modelInfo(id).provider})` })), running: adhocRunning() }}
              ideaAuthors={ideaAuthors().map((id) => getModel(id).label)}
              viral={{ ready: xConfigured(), yen: Math.round((s.viralSearchCount + s.wantsSearchCount) * 0.005 * 150) }}
            />
          ) : undefined}
        />
      </section>

      {/* 止まっているもの */}
      <section id="waiting" className="card scroll-mt-4 p-4" style={waiting.length ? { borderColor: "var(--accent)" } : undefined}>
        <Head title={`${you}の確認・対応`} note="AIだけで公開したものの確認と、AIが人に回したもの（チェックで問題が残った・上限に達したなど）です。古い順で、行を押すと案件の画面に移動します。" />
        {waiting.length === 0 ? (
          <p className="text-sm text-ink-2">いまは確認することはありません。AIが自動で進めています。</p>
        ) : (
          <ShowMore as="ul" initial={3} className="divide-y divide-line">
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
                  {/* スマホでは「種類・待ち時間」を1行目に、案件の名前と、やることを2行目に幅いっぱいで出す（PCでは1行に並べる） */}
                  <Link href={w.kind === "comment" ? "/growth#comments" : `/projects/${w.projectId}`} className="group flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 hover:bg-surface-2 sm:flex-nowrap">
                    <span
                      className="order-1 shrink-0 rounded px-1.5 py-0.5 text-center text-xs font-medium sm:w-36"
                      style={w.kind === "stuck"
                        ? { background: "var(--surface-2)", color: "var(--critical)" }
                        : { background: "var(--surface-2)", color: "var(--accent)" }}
                    >
                      {w.kind === "stuck" ? "! " : ""}{label.title}
                    </span>
                    <span className="order-3 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto">
                      <span className="font-medium">{w.title}</span>
                      {w.demo && <span className="ml-2 rounded border border-line px-1 text-[10px] text-muted">デモ</span>}
                      <span className="block text-xs text-ink-2">{label.action}</span>
                    </span>
                    <span className="num order-2 ml-auto shrink-0 text-xs text-ink-2 sm:order-3 sm:ml-0">
                      {waitLabel(w.daysWaiting)}
                      {w.daysLeft !== null && (
                        <span className="ml-2" style={{ color: urgent ? "var(--critical)" : undefined }}>
                          {urgent ? "▲ " : ""}あと{w.daysLeft}日で自動見送り
                        </span>
                      )}
                    </span>
                    <span className="order-4 hidden shrink-0 text-sm text-accent group-hover:underline sm:inline">開く →</span>
                  </Link>
                </li>
              );
            })}
          </ShowMore>
        )}
        {autoStats.published > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
            AIだけで公開したもの: {autoStats.published}件（{you}が確認済み {autoStats.reviewed}件・うち「出すべきでなかった」{autoStats.bad}件
            {autoStats.reviewed > 0 ? `＝${pct(autoStats.bad / autoStats.reviewed, 0)}` : ""}）
          </p>
        )}
        {owner && unseenPosts > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-xs text-ink-2">
            AIだけで出した投稿のうち、まだ見ていないもの <b className="num">{unseenPosts}件</b>（直近3日）
            <Link href="/growth#posts" className="ml-2 text-accent underline">確かめる</Link>
          </p>
        )}
      </section>

      {/* 今日のAIの計画は、オフィスのホワイトボードとメニューの「毎日の計画」から見る（ホームには置かない） */}

      {/* SNSの自動投稿が止まっているときだけ知らせる（一覧は集客のページ） */}
      {xLastError && (
            <p className="card p-3 text-xs" style={{ background: "var(--surface-2)", color: "var(--critical)" }}>
              ! 最後の自動投稿が失敗しました（{jstDateTime(xLastError.at)}）: {xLastError.error}
              <span className="block text-ink-2">{/credits depleted/.test(xLastError.error) ? "X の Developer Console でクレジットを購入してください。" : ""}2時間ごとに試し直します。</span>
            </p>
          )}

      {/* 推移とお金 */}
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

      {/* ほかの画面へ（ホームは毎日の確認と判断だけにする） */}
      <nav aria-label="ほかの画面" className="card flex flex-wrap gap-x-4 gap-y-2 p-4 text-sm">
        <span className="text-muted">詳しく見る:</span>
        <Link href="/projects" className="text-accent underline">案件の段階とアイデア出し</Link>
        <Link href="/growth" className="text-accent underline">集客とSNSの投稿</Link>
        <Link href="/#live" className="text-accent underline">AIの会話と処理ログ</Link>
        <Link href="/voices" className="text-accent underline">社員の声</Link>
        <Link href="/lab" className="text-accent underline">AIの成績</Link>
        <Link href="/notes" className="text-accent underline">教訓と資料</Link>
      </nav>
    </div>
  );
}

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
