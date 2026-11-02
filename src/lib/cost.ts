import { db, getSettings, type ProductKind, type ProjectRow } from "./db";
import { projectTotals } from "./loop";

// 成果1件あたりにかかったお金（AI費用＋広告費）。AI費用は、その案件のために呼んだAIの合計
export function projectCost(projectId: number) {
  const s = getSettings();
  const ai = db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE project_id = ?").get(projectId) as { s: number };
  const t = projectTotals(projectId);
  const aiJpy = ai.s * s.usdJpy;
  const totalJpy = aiJpy + t.adSpendJpy;
  return { aiJpy, adJpy: t.adSpendJpy, totalJpy, conversions: t.signups, visits: t.visits, perConversion: t.signups ? totalJpy / t.signups : null };
}

type Group = { key: string; projects: number; aiJpy: number; adJpy: number; totalJpy: number; conversions: number; visits: number; perConversion: number | null };

function sum(key: string, rows: ProjectRow[]): Group {
  const cs = rows.map((p) => projectCost(p.id));
  const g = cs.reduce((a, c) => ({ aiJpy: a.aiJpy + c.aiJpy, adJpy: a.adJpy + c.adJpy, conversions: a.conversions + c.conversions, visits: a.visits + c.visits }), { aiJpy: 0, adJpy: 0, conversions: 0, visits: 0 });
  const totalJpy = g.aiJpy + g.adJpy;
  return { key, projects: rows.length, ...g, totalJpy, perConversion: g.conversions ? totalJpy / g.conversions : null };
}

// 実案件（デモを除く）を、出し方ごと・アイデアを出したAIごとにまとめる
export function costEfficiency() {
  const projects = db().prepare("SELECT * FROM projects WHERE demo = 0").all() as ProjectRow[];
  const kinds: ProductKind[] = ["lp", "tool"];
  const authors = [...new Set(projects.map((p) => p.idea_model ?? p.model_id))];
  return {
    all: sum("all", projects),
    byKind: kinds.map((k) => sum(k, projects.filter((p) => p.kind === k))).filter((g) => g.projects > 0),
    byIdeaAuthor: authors.map((a) => sum(a, projects.filter((p) => (p.idea_model ?? p.model_id) === a))),
  };
}
