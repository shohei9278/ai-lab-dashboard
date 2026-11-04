import { db, getSettings, monthSpendUsd } from "./db";

// 月のAI予算のペース配分。1件ごとの作り方（品質）は変えずに、新しく作る案件の数を予算に合わせる
// - 予算の一部（RESERVE）は、SNSへの投稿・コメントへの返信の案・判断のために残す（1回数円で、止めると損が大きいため）
// - 残りを、月の残りの日数で割って「今日、新しい案件に使ってよい額」を出す

const RESERVE = 0.15; // 予算のうち、投稿・判断のために残す割合
const DEFAULT_PER_PROJECT_JPY = 300; // 実績がないときの、1件を作るのにかかる費用の見込み
const IDEA_ROUND_JPY = 60; // 3社のアイデア出しと採点1回分の見込み

// 最近作った案件（アイデア出しから公開までのAI費用）の平均
export function costPerProjectJpy(): number {
  const s = getSettings();
  const rows = db().prepare(
    `SELECT p.id, COALESCE(SUM(c.cost_usd), 0) AS usd FROM projects p JOIN ai_calls c ON c.project_id = p.id
     WHERE p.demo = 0 AND p.lp_version >= 1 AND p.created_at >= datetime('now', '-30 days')
       AND c.purpose NOT IN ('判断', '判断（裏比較）', 'SNS投稿の下書き', 'コメントへの返信の案', '議論', '議論の要約', '教訓メモ') AND c.model_id NOT LIKE '%-api'
     GROUP BY p.id`,
  ).all() as { id: number; usd: number }[];
  if (rows.length < 2) return DEFAULT_PER_PROJECT_JPY;
  return (rows.reduce((n, r) => n + r.usd, 0) / rows.length) * s.usdJpy;
}

export function budgetState() {
  const s = getSettings();
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const day = now.getDate();
  const daysLeft = daysInMonth - day + 1; // 今日を含む
  const spent = monthSpendUsd() * s.usdJpy;
  const budget = s.monthlyBudgetJpy;
  const creativeCap = budget * (1 - RESERVE);
  // 月の初めから今日までの使い方が続いたときの、月末の見込み
  const projected = (spent / Math.max(1, day)) * daysInMonth;
  // 今日、新しい案件に使ってよい額（今日すでに使った分は、今月の使用額に含まれている）
  const spentBeforeToday = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE strftime('%Y-%m', at) = strftime('%Y-%m', 'now') AND at < datetime('now', 'start of day')").get() as { s: number }).s * s.usdJpy;
  const spentToday = spent - spentBeforeToday;
  const allowanceToday = Math.max(0, (creativeCap - spentBeforeToday) / daysLeft - spentToday);
  const perProject = costPerProjectJpy();
  // 少し足りないだけなら作る（はみ出した分は、投稿・判断のために残している分で吸収できる）
  const newToday = Math.max(0, Math.min(s.dailyKeep, Math.round((allowanceToday - IDEA_ROUND_JPY) / perProject)));
  return {
    budget, spent, projected, daysLeft, creativeCap, perProject, allowanceToday, newToday,
    creativeOk: spent < creativeCap, // これを越えたら、新しい案件・自動の作り直しは止めて、投稿と判断だけ続ける
  };
}
