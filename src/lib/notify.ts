import { db, getSettings, saveSettings } from "./db";
import { budgetState } from "./budget";
import { waitingItems } from "./overview";
import { modelInfo } from "./models";
import { BOTTLENECK_LABEL, GOAL_LABEL, planProgress, todayPlan } from "./plan";
import type { DiaryContent } from "./diary";

// 1日1回、「今日あったこと・失敗・あなたの確認待ち」をまとめてスマホに届ける
// 送り先は NOTIFY_WEBHOOK_URL（.env.local）。Discord の Webhook URL がおすすめ（Slack の Incoming Webhook でも届く）

// 今日の計画の達成度（計画がある日だけ）
function planLine(): string[] {
  const plan = todayPlan();
  if (!plan) return [];
  const g = planProgress(plan);
  return [`・今日の計画: ネック「${BOTTLENECK_LABEL[g.content.bottleneck].split("（")[0]}」予定 ${g.done}/${g.total}件 済み${g.failed ? `（失敗${g.failed}件）` : ""}・目標 ${g.goals.map((x) => `${GOAL_LABEL[x.metric]} ${x.actual}/${x.target}`).join("・") || "なし"}`];
}

// 投稿の時間が終わる時刻。これ以降に日報を書いて、まとめと一緒に送る（日本時間）
export const NIGHTLY_HOUR = 22;

const DIARY_URL = "https://ai-lab-dashboard-production-fc9e.up.railway.app/diary";
const jstNow = () => new Date(Date.now() + 9 * 3_600_000);
const todayDiary = () => db().prepare("SELECT model_id, content FROM daily_reports WHERE day = ?").get(jstNow().toISOString().slice(0, 10)) as { model_id: string; content: string } | undefined;

// 今日の日報の見出し・やったこと・明日のこと（残りはリンク先で読む）
function diaryLines(): string[] {
  const row = todayDiary();
  if (!row) return [];
  const c = JSON.parse(row.content) as DiaryContent;
  return [
    `\n**今日の日報**（担当 ${modelInfo(row.model_id).label}）\n${c.headline}`,
    ...c.did.map((x) => `- ${x}`),
    ...(c.tomorrow ? [`明日: ${c.tomorrow}`] : []),
    `続きはこちら: ${DIARY_URL}`,
  ];
}

export const notifyConfigured = () => !!process.env.NOTIFY_WEBHOOK_URL;

export async function sendNotify(text: string): Promise<void> {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) throw new Error("NOTIFY_WEBHOOK_URL が設定されていません");
  const slack = /hooks\.slack\.com/.test(url);
  // Discord は1回に2000文字まで。長いときは分けて送る
  const chunks = slack ? [text] : text.match(/[\s\S]{1,1900}(?:\n|$)/g) ?? [text];
  for (const c of chunks) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(slack ? { text: c } : { content: c, allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) throw new Error(`通知を送れませんでした（${res.status}）`);
  }
}

const count = (sql: string, ...args: unknown[]) => (db().prepare(sql).get(...args) as { n: number }).n;

// 直近24時間のまとめ
export function buildDigest(): string {
  const s = getSettings();
  const since = "datetime('now', '-24 hours')";
  const titles = (kind: string) =>
    (db().prepare(`SELECT p.title FROM events e JOIN projects p ON p.id = e.project_id WHERE e.kind = ? AND e.at >= ${since}`).all(kind) as { title: string }[]).map((x) => x.title);
  const ideas = titles("idea");
  const published = titles("publish");
  const decisions = db().prepare(`SELECT p.title, e.message FROM events e JOIN projects p ON p.id = e.project_id WHERE e.kind IN ('auto-decision', 'rethink', 'grow', 'auto-improve', 'judge') AND e.at >= ${since}`).all() as { title: string; message: string }[];
  const posts = db().prepare(`SELECT platform, COUNT(*) AS n FROM sns_posts WHERE status = 'posted' AND posted_at >= ${since} GROUP BY platform`).all() as { platform: string; n: number }[];
  const visits = db().prepare("SELECT COALESCE(SUM(visits), 0) AS v, COALESCE(SUM(signups), 0) AS c FROM metrics WHERE day = date('now', 'localtime')").get() as { v: number; c: number };
  const errors = db().prepare(`SELECT message FROM events WHERE kind LIKE '%error%' AND at >= ${since} ORDER BY id DESC`).all() as { message: string }[];
  const comments = count("SELECT COUNT(*) AS n FROM sns_comments WHERE status = 'new'");
  const waiting = waitingItems();
  const b = budgetState();
  const label: Record<string, string> = { x: "X", threads: "Threads", bluesky: "Bluesky" };
  const lines = [
    `**AI Product Lab の1日のまとめ**（${new Date().toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}）`,
    `・新しい案件: ${ideas.length ? ideas.join("、") : "なし"}`,
    `・公開: ${published.length ? published.join("、") : "なし"}`,
    `・判断: ${decisions.length ? decisions.map((d) => `${d.title}（${d.message.slice(0, 40)}）`).join(" / ") : "なし"}`,
    ...planLine(),
    `・SNSへの投稿: ${posts.length ? posts.map((p) => `${label[p.platform] ?? p.platform} ${p.n}件`).join("・") : "なし"}`,
    `・今日の訪問 ${visits.v}人・登録/利用 ${visits.c}人`,
    `・AIの費用: 今月 約${Math.round(b.spent).toLocaleString("ja-JP")}円 / 予算 ${s.monthlyBudgetJpy.toLocaleString("ja-JP")}円（月末の見込み 約${Math.round(b.projected).toLocaleString("ja-JP")}円）`,
    ...diaryLines(),
  ];
  if (errors.length) {
    // 同じ失敗はまとめる
    const grouped = new Map<string, number>();
    for (const e of errors) grouped.set(e.message.slice(0, 120), (grouped.get(e.message.slice(0, 120)) ?? 0) + 1);
    lines.push(`\n**失敗 ${errors.length}件**\n${[...grouped].slice(0, 5).map(([m, n]) => `- ${m}${n > 1 ? `（×${n}）` : ""}`).join("\n")}`);
  }
  if (waiting.length || comments) {
    lines.push(`\n**あなたの確認待ち ${waiting.length}件**`);
    lines.push(...waiting.slice(0, 8).map((w) => `- ${w.title}（${{ idea: "アイデアの採用", publish: "公開", decision: "判断", stuck: "作業が止まっている", notify: "登録者への連絡", review: "AIだけで公開した分の確認", comment: "SNSのコメント" }[w.kind]}）`));
  } else {
    lines.push("\nあなたの確認待ちはありません。");
  }
  if (s.killSwitch) lines.unshift("**緊急停止中です。AIは何もしていません。**");
  return lines.join("\n");
}

// 1日に1回だけ送る（毎晩の日報の処理から呼ぶ）
export async function maybeDailyDigest() {
  const s = getSettings();
  if (!notifyConfigured()) return;
  const jst = jstNow();
  const today = jst.toISOString().slice(0, 10);
  if (s.lastDigest === today) return;
  // 日報を書けなかったときは1時間後に書き直すので、それを待つ。23:30 を過ぎたら日報なしで送る
  const beforeCutoff = jst.getUTCHours() * 60 + jst.getUTCMinutes() < 23 * 60 + 30;
  if (s.dailyReport && !s.killSwitch && todayPlan() && !todayDiary() && beforeCutoff) return;
  await sendNotify(buildDigest());
  saveSettings({ lastDigest: today });
}
