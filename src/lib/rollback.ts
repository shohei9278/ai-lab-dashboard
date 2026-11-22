import { db, type ProjectRow } from "./db";
import { toolErrors } from "./funnel";
import { buildingNow, logEvent } from "./loop";

// 公開後の自動の巻き戻し: 新しく公開したツールの版で、来た人の画面のエラーが前の版より増えたら、前の版に自動で戻す
// 人が寝ている間に、壊れた版のまま集客を続けないため（運営者が決めた）。直すのは、いつもの改善の流れ（Claude Code が直す → チェック → 公開）に任せる
// 来る人が1日に数人なので、「1人だけたまたま」で戻らないよう、人数と割合の両方で見る
export const ROLLBACK_MIN_ERRORS = 2; // 新しい版で、エラーが起きた人（のべ）
export const ROLLBACK_MIN_RATE = 0.3; // 新しい版で、来た人のうちエラーが起きた人の割合
const ROLLBACK_WINDOW_DAYS = 7; // 新しい版に来た人が初めて記録された日から、この日数のあいだだけ見る
const ROLLBACK_COOLDOWN_DAYS = 30; // 同じ案件では、この日数に1回まで（行ったり来たりしないように）

export type RollbackPlan = { from: number; to: number; errors: number; visits: number; prevErrors: number; prevVisits: number };

const visitsOf = (projectId: number, version: number) =>
  (db().prepare("SELECT COALESCE(SUM(visits), 0) AS n FROM metrics WHERE project_id = ? AND source = 'real' AND lp_version = ?").get(projectId, version) as { n: number }).n;
const errorsOf = (projectId: number, version: number) =>
  toolErrors(db().prepare("SELECT name, detail, visitors FROM lp_funnel WHERE project_id = ? AND version = ? AND name = 'tool_error'").all(projectId, version) as { name: string; detail: string; visitors: number }[])
    .reduce((a, e) => a + e.visitors, 0);

// 戻すかどうかと、どの版に戻すか（戻さないときは null）
export function rollbackPlan(p: ProjectRow): RollbackPlan | null {
  if (p.kind !== "tool" || p.demo || !p.public_slug || p.public_version === null) return null;
  if (!["live", "hold"].includes(p.stage)) return null;
  // 公開していない新しい版があるとき（承認待ちなど）・作り直しの途中は触らない（その版を上書きしてしまうため）
  if (p.lp_version !== p.public_version || buildingNow(p.id)) return null;
  const v = p.public_version;
  // 新しい版に来た人が、まだ7日たっていないこと
  const first = (db().prepare("SELECT MIN(day) AS d FROM metrics WHERE project_id = ? AND source = 'real' AND lp_version = ?").get(p.id, v) as { d: string | null }).d;
  if (!first || first < (db().prepare("SELECT date('now', '+9 hours', ?) AS d").get(`-${ROLLBACK_WINDOW_DAYS} days`) as { d: string }).d) return null;
  // 前に来た人に見せていた版（公開中の版より前で、来た人の記録がある、いちばん新しい版）
  const prev = (db().prepare("SELECT MAX(lp_version) AS v FROM metrics WHERE project_id = ? AND source = 'real' AND lp_version < ? AND visits > 0").get(p.id, v) as { v: number | null }).v;
  if (prev === null || !db().prepare("SELECT 1 FROM lp_versions WHERE project_id = ? AND version = ?").get(p.id, prev)) return null;
  const errors = errorsOf(p.id, v);
  const visits = visitsOf(p.id, v);
  if (errors < ROLLBACK_MIN_ERRORS || visits <= 0 || errors / visits < ROLLBACK_MIN_RATE) return null;
  const prevErrors = errorsOf(p.id, prev);
  const prevVisits = visitsOf(p.id, prev);
  // 前の版のほうがエラーの割合が低いときだけ戻す（前の版でも同じくらい起きていたなら、戻しても直らない）
  if (prevVisits <= 0 || prevErrors / prevVisits >= errors / visits) return null;
  // 同じ案件では、30日に1回まで
  if (db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'auto-rollback' AND at >= datetime('now', ?)").get(p.id, `-${ROLLBACK_COOLDOWN_DAYS} days`)) return null;
  return { from: v, to: prev, errors, visits, prevErrors, prevVisits };
}

// 取り込みのたびに呼ぶ。戻したら true。公開（publish）は呼ぶ側から渡す（publish.ts と互いに読み込み合わないように）
export async function autoRollback(p: ProjectRow, publish: (p: ProjectRow) => Promise<boolean>): Promise<boolean> {
  const plan = rollbackPlan(p);
  if (!plan) return false;
  const live = db().prepare("SELECT lp FROM lp_versions WHERE project_id = ? AND version = ?").get(p.id, plan.to) as { lp: string };
  const conn = db();
  conn.prepare("UPDATE lp_versions SET note = COALESCE(note, '') || '（来た人の画面のエラーが増えたため、自動で取り下げ）' WHERE project_id = ? AND version = ?").run(p.id, plan.from);
  conn.prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(live.lp, plan.to, p.id);
  const back = conn.prepare("SELECT * FROM projects WHERE id = ?").get(p.id) as ProjectRow;
  try {
    if (!(await publish(back))) throw new Error("公開の設定がありません");
  } catch (e) {
    // 公開できなかったら、手元も元に戻す（公開中の版と手元の版を食い違わせない）
    conn.prepare("UPDATE projects SET lp = ?, lp_version = ?, updated_at = datetime('now') WHERE id = ?").run(p.lp, plan.from, p.id);
    logEvent(p.id, "system", "rollback-error", `第${plan.from}版を第${plan.to}版に戻そうとしましたが、公開できませんでした: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
    return false;
  }
  logEvent(p.id, "system", "auto-rollback",
    `第${plan.from}版で、来た人の画面のエラーが増えたため（${plan.visits}人中${plan.errors}人。前の第${plan.to}版は${plan.prevVisits}人中${plan.prevErrors}人）、第${plan.to}版に自動で戻しました。直すのは、いつもの改善の流れに任せます`);
  return true;
}
