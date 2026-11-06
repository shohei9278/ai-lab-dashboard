import { getSettings } from "./db";
import { logEvent, runDaily, syncAndJudge } from "./loop";
import { publishingConfigured } from "./publish";
import { maybeWeeklyReport } from "./report";
import { maybeRefreshTrends } from "./trends";
import { maybeAutoPost } from "./sns";
import { syncComments } from "./snsComments";
import { maybeDailyDigest } from "./notify";
import { maybeDailyBackup } from "./backup";
import { resumeRefQueue } from "./designRefs";
import { maybeWeeklyViral, resumeViralQueue } from "./viralPosts";
import { maybeCreatePlan, runPlanTasks } from "./plan";
import { syncReactions } from "./postReactions";

// アプリ（サーバー）が起動している間だけ動く。PCを閉じている間は動かず、次に起動したときに追いつく
const CHECK_EVERY_MS = 5 * 60 * 1000;

const g = globalThis as unknown as { __aiLabScheduler?: NodeJS.Timeout; __aiLabNextTick?: number; __aiLabTicking?: boolean };

export function startScheduler() {
  if (g.__aiLabScheduler) return;
  g.__aiLabScheduler = setInterval(tick, CHECK_EVERY_MS);
  g.__aiLabNextTick = Date.now() + 60 * 1000;
  setTimeout(tick, 60 * 1000); // 起動直後に1回確認する
}

export function schedulerStatus() {
  return { running: Boolean(g.__aiLabScheduler), checkEveryMinutes: CHECK_EVERY_MS / 60000, nextTick: g.__aiLabNextTick ?? null };
}

async function tick() {
  g.__aiLabNextTick = Date.now() + CHECK_EVERY_MS;
  // 前の回の処理（アイデア出しや作成は数分かかる）がまだ終わっていなければ、この回は休む（同じ案件を二重に判断しないように）
  if (g.__aiLabTicking) return;
  g.__aiLabTicking = true;
  try {
    await tickNow();
  } finally {
    g.__aiLabTicking = false;
  }
}

async function tickNow() {
  // 公開中のLPの本物の数字は、毎回取り込む
  try {
    if (publishingConfigured()) await syncAndJudge();
  } catch (e) {
    logEvent(null, "system", "sync-error", `集客データの取り込みでエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  // 世の中の話題は、アイデア出しより先に取っておく
  try {
    await maybeRefreshTrends();
  } catch (e) {
    logEvent(null, "system", "trend-error", `話題の取得でエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  try {
    await maybeWeeklyReport();
  } catch (e) {
    logEvent(null, "system", "report-error", `週のレポートの作成でエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  resumeRefQueue();
  resumeViralQueue();
  try {
    await maybeWeeklyViral();
  } catch (e) {
    logEvent(null, "system", "viral-error", `Xで話題の投稿の検索でエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  try {
    const file = await maybeDailyBackup();
    if (file) logEvent(null, "system", "backup", `データベースのバックアップを取りました（${file}）`);
  } catch (e) {
    logEvent(null, "system", "backup-error", `データベースのバックアップに失敗: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  try {
    await maybeDailyDigest();
  } catch (e) {
    logEvent(null, "system", "notify-error", `1日のまとめを送れませんでした: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  try {
    await syncComments();
  } catch (e) {
    logEvent(null, "system", "sns-comments-error", `コメントの取り込みでエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  // 投稿についた反応を取り込む（計画を作る前に。1時間に1回）
  await syncReactions().catch(() => 0);
  // 毎朝の計画を作り、時刻が来た予定を実行する（毎日の自動実行より先に。計画で新しい案件を休むことがあるため）
  await maybeCreatePlan();
  try {
    await runPlanTasks();
  } catch (e) {
    logEvent(null, "system", "plan-task-error", `今日の計画の予定の実行でエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  try {
    await maybeAutoPost();
  } catch (e) {
    logEvent(null, "system", "sns-auto-error", `Xへの自動投稿でエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  try {
    const s = getSettings();
    if (!s.dailyEnabled || new Date().getHours() < s.dailyHour) return;
    await runDaily();
  } catch (e) {
    logEvent(null, "system", "daily-error", `毎日の自動実行でエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
}
