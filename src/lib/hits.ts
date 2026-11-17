import { db, getSettings, saveSettings } from "./db";
import { AIMS, isAim, type Aim } from "./aims";
import { jstToday, logEvent, projectTotals } from "./loop";
import { X_READ_COST_USD, xConfigured, xMyFollowers } from "./xPost";

// 当たりから学ぶ
// - 運営のアカウントのフォロワー数を1日1回記録する（どの案件の公開のあとに増えたかを、だいたい見る）
// - ねらい・ジャンルごとに、遊んだ人・シェア・当たり・フォロワーの増えをまとめ、次のアイデア出しに渡す

// ---- フォロワー数 ----

// 今日（日本時間）まだ記録していなければ、X のフォロワー数を読んで記録する（失敗しても、その日はもう読まない）
export async function maybeRecordFollowers(): Promise<number | null> {
  const s = getSettings();
  const today = jstToday();
  if (s.killSwitch || !xConfigured() || s.lastFollowersTry === today) return null;
  saveSettings({ lastFollowersTry: today });
  try {
    const n = await xMyFollowers();
    db().prepare("INSERT INTO account_stats (day, platform, followers) VALUES (?, 'x', ?) ON CONFLICT(day, platform) DO UPDATE SET followers = excluded.followers, at = datetime('now')").run(today, n);
    return n;
  } finally {
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (NULL, ?, 'x-api', 0, 0, ?, NULL)").run("X のフォロワー数", X_READ_COST_USD);
  }
}

export type FollowerRow = { day: string; followers: number };
export const followerHistory = (days = 30): FollowerRow[] =>
  (db().prepare("SELECT day, followers FROM account_stats WHERE platform = 'x' ORDER BY day DESC LIMIT ?").all(days) as FollowerRow[]).reverse();

// その日（日本時間）か、それより前でいちばん近い日のフォロワー数（記録がなければ null）
function followersOn(day: string): number | null {
  const r = db().prepare("SELECT followers FROM account_stats WHERE platform = 'x' AND day <= ? ORDER BY day DESC LIMIT 1").get(day) as { followers: number } | undefined;
  return r?.followers ?? null;
}
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// UTC の日時（"YYYY-MM-DD HH:MM:SS"）を、日本時間の日付にする
const jstDayOf = (utc: string) => new Date(Date.parse(utc.replace(" ", "T") + "Z") + 9 * 3_600_000).toISOString().slice(0, 10);

// ---- ねらい・ジャンルごとの成績 ----

export type HitRow = {
  id: number; title: string; aim: Aim; genre: string | null; publishedDay: string;
  plays: number; shares: number;
  hit: boolean | null; // 当たったか（「広がる」は3日の判定、ほかは「続ける」で育てる段階に入ったか。まだ分からなければ null）
  followersGain: number | null; // 公開の日から3日後までのフォロワーの増え（ほかの案件の公開と重なることもあるので、だいたい）
};

// 最近（90日）公開した、ねらいの付いた案件の成績
export function hitRows(days = 90): HitRow[] {
  const rows = db().prepare(
    `SELECT id, title, aim, genre, published_at, stage, growth_phase, spread_hit FROM projects
     WHERE demo = 0 AND aim IS NOT NULL AND published_at IS NOT NULL AND published_at >= datetime('now', ?) ORDER BY published_at DESC`,
  ).all(`-${days} days`) as { id: number; title: string; aim: string; genre: string | null; published_at: string; stage: string; growth_phase: number; spread_hit: number | null }[];
  const today = jstToday();
  return rows.filter((r) => isAim(r.aim)).map((r) => {
    const t = projectTotals(r.id);
    const day = jstDayOf(r.published_at);
    const later = addDays(day, 3);
    // 公開の前の日の数と、3日後の数（3日たっていなければ、まだ測れない）
    const before = followersOn(addDays(day, -1));
    const after = later <= today ? followersOn(later) : null;
    const hit = r.aim === "spread"
      ? r.spread_hit === null ? null : r.spread_hit === 1
      : r.growth_phase || r.stage === "continued" ? true : r.stage === "killed" ? false : null;
    return {
      id: r.id, title: r.title, aim: r.aim as Aim, genre: r.genre, publishedDay: day,
      plays: t.signups, shares: t.rows.reduce((n, x) => n + (x.shares ?? 0), 0),
      hit, followersGain: before !== null && after !== null ? after - before : null,
    };
  });
}

export type HitGroup = { aim: Aim; genre: string; count: number; judged: number; hits: number; plays: number; shares: number; gain: number | null; gainCount: number };

// ねらい・ジャンルごとにまとめる（当たりの多い順、同じなら件数の多い順）
export function hitGroups(rows: HitRow[] = hitRows()): HitGroup[] {
  const map = new Map<string, HitGroup>();
  for (const r of rows) {
    const genre = r.genre?.trim() || "（ジャンルなし）";
    const key = `${r.aim}\u0000${genre}`;
    const g = map.get(key) ?? { aim: r.aim, genre, count: 0, judged: 0, hits: 0, plays: 0, shares: 0, gain: null, gainCount: 0 };
    g.count++;
    if (r.hit !== null) g.judged++;
    if (r.hit) g.hits++;
    g.plays += r.plays;
    g.shares += r.shares;
    if (r.followersGain !== null) {
      g.gain = (g.gain ?? 0) + r.followersGain;
      g.gainCount++;
    }
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.hits - a.hits || b.count - a.count);
}

// アイデア出しに渡す文（成績があるときだけ）。当たったジャンルは少し多めに、ただし新しいジャンルを試す分は必ず残す
export function hitsText(): string {
  const groups = hitGroups();
  if (!groups.length) return "";
  const lines = groups.slice(0, 20).map((g) =>
    `- ${AIMS[g.aim].label}・${g.genre}: ${g.count}件（判定済み${g.judged}件のうち当たり${g.hits}件）/ 遊んだ・使った人 計${g.plays}人 / シェア 計${g.shares}件${g.gainCount ? ` / 公開から3日のフォロワーの増え 計${g.gain}人（${g.gainCount}件分。ほかの公開と重なるので、だいたい）` : ""}`);
  return `\n\n最近の成績（ねらい・ジャンルごと。公開から90日。件数が少ないうちは偶然の差が大きいので、言い切らない）:\n${lines.join("\n")}\n使い方: 当たったジャンル・切り口は少し多めに出してよいが、広がる・また来てもらう の案のうち3割以上は、まだ試していないジャンルにする（当たりの型に寄りすぎると飽きられ、新しい当たりも見つからない）。当たらなかったジャンルは、切り口を変えるか、別のジャンルにする`;
}

// 毎日の見回りから呼ぶ（失敗は経過に残すだけ）
export async function maybeRecordFollowersSafe() {
  try {
    const n = await maybeRecordFollowers();
    if (n !== null) logEvent(null, "system", "followers", `X のフォロワー数を記録しました（${n}人）`);
  } catch (e) {
    logEvent(null, "system", "followers-error", `X のフォロワー数を読めませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}
