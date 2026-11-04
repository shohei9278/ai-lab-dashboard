import { getSettings } from "./db";
import { logEvent, runDaily, syncAndJudge } from "./loop";
import { publishingConfigured } from "./publish";
import { maybeWeeklyReport } from "./report";
import { maybeRefreshTrends } from "./trends";
import { maybeAutoPost } from "./sns";
import { syncComments } from "./snsComments";

// アプリ（サーバー）が起動している間だけ動く。PCを閉じている間は動かず、次に起動したときに追いつく
const CHECK_EVERY_MS = 15 * 60 * 1000;

const g = globalThis as unknown as { __aiLabScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (g.__aiLabScheduler) return;
  g.__aiLabScheduler = setInterval(tick, CHECK_EVERY_MS);
  setTimeout(tick, 60 * 1000); // 起動直後に1回確認する
}

export function schedulerStatus() {
  return { running: Boolean(g.__aiLabScheduler), checkEveryMinutes: CHECK_EVERY_MS / 60000 };
}

async function tick() {
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
  try {
    await syncComments();
  } catch (e) {
    logEvent(null, "system", "sns-comments-error", `コメントの取り込みでエラー: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
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
