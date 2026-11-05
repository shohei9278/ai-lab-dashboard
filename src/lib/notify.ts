import { db, getSettings, saveSettings } from "./db";
import { budgetState } from "./budget";
import { waitingItems } from "./overview";

// 1日1回、「今日あったこと・失敗・あなたの確認待ち」をまとめてスマホに届ける
// 送り先は NOTIFY_WEBHOOK_URL（.env.local）。Discord の Webhook URL がおすすめ（Slack の Incoming Webhook でも届く）

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
    `・SNSへの投稿: ${posts.length ? posts.map((p) => `${label[p.platform] ?? p.platform} ${p.n}件`).join("・") : "なし"}`,
    `・今日の訪問 ${visits.v}人・登録/利用 ${visits.c}人`,
    `・AIの費用: 今月 約${Math.round(b.spent).toLocaleString("ja-JP")}円 / 予算 ${s.monthlyBudgetJpy.toLocaleString("ja-JP")}円（月末の見込み 約${Math.round(b.projected).toLocaleString("ja-JP")}円）`,
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

// 毎日、日本時間の夜（設定の時刻）以降に1回だけ送る
export async function maybeDailyDigest() {
  const s = getSettings();
  if (!notifyConfigured()) return;
  const jst = new Date(Date.now() + 9 * 3_600_000);
  const today = jst.toISOString().slice(0, 10);
  if (jst.getUTCHours() < s.digestHour || s.lastDigest === today) return;
  await sendNotify(buildDigest());
  saveSettings({ lastDigest: today });
}
