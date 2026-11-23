import { db } from "./db";

// アイデア出しの「実験枠」（提案箱 #95）
// 数字の良い方向にばかり寄せると、似たツールばかりになり、大当たりの種がなくなる（運営者の判断）。
// 出す案の1割（直近7日で少なくとも1件）は、これまでの数字・効いた手・人気のジャンルを渡さずに、
// まだ作ったことのないジャンルや形で考えさせる。採点・案件化は今までどおり。成績は分けて集計し、定例会議の材料に出す

export const EXPLORE_SHARE = 0.1;
export const EXPLORE_LABEL = "実験枠";

// 今回の枠のうち、実験枠にする数。done は直近7日に出した案（見るだけのものを除く）の数と、そのうちの実験枠の数
// 直近7日と今回を合わせた案の1割（切り捨て。少なくとも1件）に届くまで足す
export function exploreSlots(total: number, done: { ideas: number; explore: number }): number {
  if (total <= 0) return 0;
  const want = Math.max(1, Math.floor((done.ideas + total) * EXPLORE_SHARE));
  return Math.max(0, Math.min(total, want - done.explore));
}

export function exploreDone(): { ideas: number; explore: number } {
  const r = db().prepare("SELECT COUNT(*) AS n, COALESCE(SUM(explore), 0) AS e FROM idea_candidates WHERE practice = 0 AND at >= datetime('now', '-7 days')").get() as { n: number; e: number };
  return { ideas: r.n, explore: r.e };
}

// 実験枠の案に渡す、これまで作ったジャンル（これ以外から選ばせる。数字や人気の順は渡さない）
export function madeGenres(): string[] {
  return (db().prepare("SELECT DISTINCT genre FROM projects WHERE demo = 0 AND genre IS NOT NULL AND genre != '' ORDER BY genre").all() as { genre: string }[]).map((r) => r.genre);
}

type SlotStats = { ideas: number; avgScore: number | null; projects: number; published: number; visits: number; conversions: number; continued: number; killed: number };

// 実験枠とふつうの枠の成績（案の数・平均点・案件にした数・公開・訪問・登録や利用・続ける・撤退）
export function exploreStats(): { explore: SlotStats; normal: SlotStats } {
  const one = (flag: 0 | 1): SlotStats => {
    const c = db().prepare("SELECT COUNT(*) AS n, AVG(avg_score) AS a FROM idea_candidates WHERE practice = 0 AND explore = ?").get(flag) as { n: number; a: number | null };
    const p = db().prepare(
      `SELECT COUNT(*) AS n, SUM(public_slug IS NOT NULL) AS pub, SUM(stage = 'continued' OR growth_phase = 1) AS cont, SUM(stage = 'killed') AS killed
       FROM projects WHERE demo = 0 AND explore = ?`,
    ).get(flag) as { n: number; pub: number | null; cont: number | null; killed: number | null };
    const m = db().prepare(
      `SELECT COALESCE(SUM(m.visits), 0) AS v, COALESCE(SUM(m.signups), 0) AS s FROM metrics m JOIN projects p ON p.id = m.project_id
       WHERE p.demo = 0 AND p.explore = ? AND m.source != 'simulated'`,
    ).get(flag) as { v: number; s: number };
    return { ideas: c.n, avgScore: c.a, projects: p.n, published: p.pub ?? 0, visits: m.v, conversions: m.s, continued: p.cont ?? 0, killed: p.killed ?? 0 };
  };
  return { explore: one(1), normal: one(0) };
}

export function exploreStatsText(): string {
  const { explore, normal } = exploreStats();
  const line = (name: string, x: SlotStats) =>
    `- ${name}: 案 ${x.ideas}件（平均 ${x.avgScore === null ? "—" : x.avgScore.toFixed(1)}点）・案件 ${x.projects}件・公開 ${x.published}件・訪問 ${x.visits}人・登録や利用 ${x.conversions}人（${x.visits ? ((x.conversions / x.visits) * 100).toFixed(1) : "—"}%）・続ける ${x.continued}件・撤退 ${x.killed}件`;
  return `アイデアの${EXPLORE_LABEL}とふつうの枠の成績（これまで。${EXPLORE_LABEL}は、過去の数字・効いた手・人気のジャンルを渡さずに、まだ作ったことのないジャンルや形で出させた案。出す案の${Math.round(EXPLORE_SHARE * 100)}%）:
${line(EXPLORE_LABEL, explore)}
${line("ふつうの枠", normal)}`;
}
