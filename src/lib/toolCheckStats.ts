import { db } from "./db";

// ツールのチェックの止めた割合（運営者が決めた）
// 公開前チェックのテスト（checkEval.ts）は紹介ページのチェックだけを測る。ツールのチェック（loop.ts の reviewTool）は、
// 1件ごとの失敗から項目が増え続けているので、止めすぎが増えていないかを週ごとの割合で見る（AIは呼ばない）
// - 2026-11-25 からは、1回ごとの記録（tool_checks）で数える（AIのチェックが止めた数だけを数える）
// - それより前の週は、AIを呼んだ記録（ai_calls の「ツールチェック」）と、止めたときの経過（events）からの概算（決まり・自動テストの指摘で止めたものも含む）

export type ToolCheckWeek = { week: string; checks: number; flagged: number; rate: number | null; estimate: boolean; byClaudeCode: number };
export type ToolCheckIssue = { at: string; title: string | null; by: string; issues: string[] };

const WEEKS = 8;
// 日本時間の月曜はじまりの週（YYYY-MM-DD）
const weekOf = (col: string) => `date(${col}, '+9 hours', '-6 days', 'weekday 1')`;
const FLAGGED_EVENTS = "(message LIKE 'ツールのチェックで問題が見つかったため書き直し%' OR message LIKE 'Claude Code で作ったツールのチェックで指摘があります%')";

export function toolCheckWeeks(weeks = WEEKS): ToolCheckWeek[] {
  const since = `date('now', '+9 hours', '-6 days', 'weekday 1', '-${(weeks - 1) * 7} days')`;
  const exact = new Map((db().prepare(
    `SELECT ${weekOf("at")} AS w, COUNT(*) AS n, SUM(ai_ok = 0) AS f, SUM(by = 'claude-code') AS c FROM tool_checks WHERE ${weekOf("at")} >= ${since} GROUP BY w`,
  ).all() as { w: string; n: number; f: number; c: number }[]).map((r) => [r.w, r]));
  const first = (db().prepare(`SELECT ${weekOf("MIN(at)")} AS w FROM tool_checks`).get() as { w: string | null }).w;
  // 記録を始める前の週だけ、概算で埋める（記録を始めた週は、記録だけで数える）
  const calls = new Map((db().prepare(
    `SELECT ${weekOf("at")} AS w, COUNT(*) AS n FROM ai_calls WHERE purpose = 'ツールチェック' AND error IS NULL AND ${weekOf("at")} >= ${since} GROUP BY w`,
  ).all() as { w: string; n: number }[]).map((r) => [r.w, r.n]));
  const flaggedEv = new Map((db().prepare(
    `SELECT ${weekOf("at")} AS w, COUNT(*) AS n FROM events WHERE kind = 'review' AND ${FLAGGED_EVENTS} AND ${weekOf("at")} >= ${since} GROUP BY w`,
  ).all() as { w: string; n: number }[]).map((r) => [r.w, r.n]));
  const start = db().prepare(`SELECT ${since} AS s`).get() as { s: string };
  const out: ToolCheckWeek[] = [];
  for (let i = 0; i < weeks; i++) {
    const week = (db().prepare("SELECT date(?, ?) AS d").get(start.s, `+${i * 7} days`) as { d: string }).d;
    const e = exact.get(week);
    if (e || (first && week >= first)) {
      const n = e?.n ?? 0;
      const f = e?.f ?? 0;
      out.push({ week, checks: n, flagged: f, rate: n ? f / n : null, estimate: false, byClaudeCode: e?.c ?? 0 });
    } else {
      const n = calls.get(week) ?? 0;
      // 1回のチェックで止めた経過は1件まで。数が呼び出しを超えないようにそろえる
      const f = Math.min(n, flaggedEv.get(week) ?? 0);
      out.push({ week, checks: n, flagged: f, rate: n ? f / n : null, estimate: true, byClaudeCode: 0 });
    }
  }
  return out;
}

// 最近、AIのチェックが止めたときの指摘（運営者だけに見せる。AIの出力なので）
export function recentToolCheckIssues(limit = 10): ToolCheckIssue[] {
  return (db().prepare(
    "SELECT c.at, p.title, c.by, c.ai_issues FROM tool_checks c LEFT JOIN projects p ON p.id = c.project_id WHERE c.ai_ok = 0 ORDER BY c.id DESC LIMIT ?",
  ).all(limit) as { at: string; title: string | null; by: string; ai_issues: string }[]).map((r) => ({ at: r.at, title: r.title, by: r.by, issues: JSON.parse(r.ai_issues) as string[] }));
}
