import { db } from "./db";
import { sourceLabel, type RequestRow } from "./plan";

// やった改善の答え合わせ: 提案箱で「やった」になった提案の、前後7日の1日あたりの数字
// 提案の「やった・見送り」は会議に渡していたが、やったあとに数字が良くなったかは誰も見ていなかった（運営者が、会議が過去に基づいて改善しているかを尋ね、足すと決めた）
// 案件の提案はその案件の数字、それ以外は全案件の合計で見る。同じ時期にほかの変更もあるので、1つの改善の効果とは言い切れない

const DAY = 86_400_000;
const jday = (t: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(t));
const dayStart = (d: string) => Date.parse(`${d}T00:00:00+09:00`);

// from 以上 to 未満の日の、訪問と成果の合計（デモ・仮の数字は除く）
function totals(from: string, to: string, projectId: number | null): { visits: number; conversions: number } {
  const r = db().prepare(
    `SELECT COALESCE(SUM(m.visits), 0) AS v, COALESCE(SUM(m.signups), 0) AS c FROM metrics m JOIN projects p ON p.id = m.project_id
     WHERE p.demo = 0 AND m.source != 'simulated' AND m.day >= ? AND m.day < ? ${projectId ? "AND m.project_id = ?" : ""}`,
  ).get(from, to, ...(projectId ? [projectId] : [])) as { v: number; c: number };
  return { visits: r.v, conversions: r.c };
}

export type DoneEffect = { id: number; title: string; target: string; source: string; day: string; projectId: number | null; afterDays: number; before: { visits: number; conversions: number }; after: { visits: number; conversions: number } };

// やってから days 日以内のもの（敗者復活は、やった＝案件を作ったことなので除く）
export function doneEffects(days = 28, now = Date.now()): DoneEffect[] {
  const rows = db().prepare("SELECT * FROM plan_requests WHERE status = 'done' AND source != 'revival' AND decided_at >= datetime('now', ?) ORDER BY decided_at DESC LIMIT 15").all(`-${days} days`) as RequestRow[];
  const today = jday(now);
  return rows.map((r) => {
    const day = jday(Date.parse(`${r.decided_at!.replace(" ", "T")}Z`));
    const end = jday(Math.min(dayStart(day) + 7 * DAY, dayStart(today))); // 今日はまだ途中なので数えない
    const afterDays = Math.max(0, Math.round((dayStart(end) - dayStart(day)) / DAY));
    return {
      id: r.id, title: r.title, target: r.target, source: sourceLabel(r), day, projectId: r.project_id, afterDays,
      before: totals(jday(dayStart(day) - 7 * DAY), day, r.project_id), after: totals(day, end, r.project_id),
    };
  });
}

const perDay = (n: number, d: number) => (d ? (n / d).toFixed(1) : "—");

export function doneEffectsText(days = 28): string {
  const xs = doneEffects(days);
  if (!xs.length) return "やった改善の前後: まだない";
  return `やった改善の前後（提案箱で「やった」になった日の前7日と後の、1日あたりの訪問・成果。案件の提案はその案件、ほかは全案件の合計。同じ時期にほかの変更や宣伝の量の違いもあるので、1つの改善の効果とは言い切れない。後が3日に満たないものは、まだ判断しない）:
${xs.map((x) => `- 「${x.title}」（${x.target === "system" ? "仕組み" : "運営者"}・${x.source}・${x.day.slice(5)}にやった${x.projectId ? `・#${x.projectId}` : "・全案件"}）: 訪問 ${perDay(x.before.visits, 7)} → ${perDay(x.after.visits, x.afterDays)}・成果 ${perDay(x.before.conversions, 7)} → ${perDay(x.after.conversions, x.afterDays)}（後は${x.afterDays}日分${x.afterDays < 3 ? "。まだ判断しない" : ""}）`).join("\n")}`;
}
