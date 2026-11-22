import { db, getSettings } from "./db";
import { costEfficiency } from "./cost";
import { listInterventions, operationCounts } from "./interventions";
import { autoPublishStats } from "./loop";
import { memberProfiles, showcaseProjects, showcaseRoutineStats } from "./showcase";
import { STALE_NOTE } from "./voices";

// 実験の概要ページと同じ数え方の、外に出してよい数字だけ（ポートフォリオが読みに来る。/api/showcase/numbers）
// 来訪者が概要ページで見られる数字の合計だけにする。題・中身・AIの入出力・個人の情報は入れない
export type ShowcaseNumbers = {
  at: string; // 数えた時刻（UTC の ISO）
  totals: { ideas: number; projects: number; published: number; visits: number; conversions: number; aiCostJpy: number; perConversionJpy: number | null };
  autoPublish: { published: number; reviewed: number; bad: number };
  staff: { id: string; candidates: number; selected: number; lean: "self" | "strict" | "even" | null }[];
  improvements: { human: number; aiDone: number };
  operations: { label: string; n: number }[];
  routines: ReturnType<typeof showcaseRoutineStats>;
};

export function showcaseNumbers(): ShowcaseNumbers {
  const s = getSettings();
  const cost = costEfficiency().all;
  const ideas = (db().prepare("SELECT COUNT(*) AS n FROM idea_candidates").get() as { n: number }).n;
  const projects = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE demo = 0").get() as { n: number }).n;
  const aiCostJpy = (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls").get() as { s: number }).s * s.usdJpy;
  // 改善の記録の件数（/interventions の月ごとの数と同じ数え方。返事がないまま30日で見送ったものは入れない）
  const human = listInterventions().length;
  const aiDone = (db().prepare("SELECT COUNT(*) AS n FROM plan_requests WHERE target = 'system' AND source != 'human' AND status = 'done' AND COALESCE(note, '') != ?").get(STALE_NOTE) as { n: number }).n;
  return {
    at: new Date().toISOString(),
    totals: {
      ideas, projects,
      published: showcaseProjects().filter((p) => p.published).length,
      visits: cost.visits, conversions: cost.conversions,
      aiCostJpy: Math.round(aiCostJpy),
      perConversionJpy: cost.perConversion === null ? null : Math.round(cost.perConversion),
    },
    autoPublish: autoPublishStats(),
    staff: memberProfiles().map((m) => ({ id: m.id, candidates: m.candidates, selected: m.selected, lean: m.lean })),
    improvements: { human, aiDone },
    operations: operationCounts(),
    routines: showcaseRoutineStats(),
  };
}
