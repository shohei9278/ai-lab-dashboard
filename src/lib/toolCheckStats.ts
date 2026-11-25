import { db } from "./db";
import { logEvent } from "./loop";

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

// 定例会議の材料（weekly.ts の meetingMaterial）: 週ごとの止めた割合と、最近止めたときの指摘。止めすぎが増えていれば、項目を外す・言い方を変える案につなげる（運営者が決めた）
export function toolCheckText(): string {
  const weeks = toolCheckWeeks(6).filter((w) => w.checks > 0);
  if (!weeks.length) return "ツールのチェック（公開前にAIがツールのコードを読む）の止めた割合: まだチェックがない";
  const issues = recentToolCheckIssues(5);
  return `ツールのチェック（公開前にAIがツールのコードを読む）の止めた割合（週ごと。概算の週は、決まり・自動テストの指摘で止めたものも含む）:
${weeks.map((w) => `- ${w.week} の週: ${w.checks}回中${w.flagged}回止めた（${w.rate === null ? "—" : `${Math.round(w.rate * 100)}%`}）${w.estimate ? "・概算" : ""}`).join("\n")}${issues.length ? `\n最近AIのチェックが止めたときの指摘:\n${issues.map((x) => `- ${x.title ?? "（案件なし）"}: ${x.issues.join(" / ").slice(0, 200) || "（指摘の文なし）"}`).join("\n")}` : ""}`;
}

// 止めた割合が急に上がったら知らせる（運営者が決めた。月曜の定例会議を待たずに気づけるように。AIは呼ばない）
// 今週のチェックが TOOL_CHECK_ALERT_MIN 回以上で、前の4週間（チェックのあった週）の平均より TOOL_CHECK_ALERT_JUMP 以上高いとき。1週に1回まで
export const TOOL_CHECK_ALERT_MIN = 5;
export const TOOL_CHECK_ALERT_JUMP = 0.15;
export function checkToolCheckJump(): string | null {
  const weeks = toolCheckWeeks(5);
  const now = weeks.at(-1)!;
  const base = weeks.slice(0, -1).filter((w) => w.rate !== null);
  if (now.checks < TOOL_CHECK_ALERT_MIN || now.rate === null || base.length < 2) return null;
  const avg = base.reduce((n, w) => n + w.rate!, 0) / base.length;
  if (now.rate - avg < TOOL_CHECK_ALERT_JUMP) return null;
  const mark = `（${now.week} の週）`;
  if (db().prepare("SELECT 1 FROM events WHERE kind = 'tool-check-alert' AND message LIKE ?").get(`%${mark}%`)) return null;
  const msg = `ツールのチェックの止めた割合が上がっています${mark}: ${now.checks}回中${now.flagged}回（${Math.round(now.rate * 100)}%）。前の${base.length}週の平均は${Math.round(avg * 100)}%です。チェックの項目が止めすぎていないか、AIの成績で最近の指摘を見てください`;
  logEvent(null, "system", "tool-check-alert", msg);
  return msg;
}
