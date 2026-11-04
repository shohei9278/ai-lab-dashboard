import { db, type EventRow } from "./db";
import { debateFor, type DebateResult, type Decision, type ShadowRow } from "./loop";
import { modelInfo } from "./models";

// 案件の画面の「経過」で、行を押すと開く中身（どんな候補があったか・各AIの点と理由・判断と議論）

type Score = { scorer: string; score: number; reason: string | null };
export type EventDetail =
  | {
      type: "ideas";
      candidates: {
        label: string; title: string; author: string | null; avg: number | null; selected: boolean; isThis: boolean;
        kind: string | null; target: string | null; problem: string | null; solution: string | null; reason: string | null; channel: string | null; scores: Score[];
      }[];
    }
  | { type: "lp"; candidates: { id: number; label: string; author: string; avg: number | null; selected: boolean; humanSelected: boolean; headline: string; scores: Score[] }[] }
  | {
      type: "judge";
      rows: { model: string; isPrimary: boolean; decision: string | null; confidence: number | null; reason: string | null; nextAction: string | null; error: string | null }[];
      debate: DebateResult | null;
    };

const DECISION_SHORT: Record<Decision["decision"], string> = { continue: "続ける", improve: "改善", collect: "集客継続", kill: "撤退", rethink: "集客を見直す" };
export const decisionShort = (d: string | null) => (d ? DECISION_SHORT[d as Decision["decision"]] ?? d : "—");

const scoresOf = (table: "idea_scores" | "lp_candidate_scores", candidateId: number): Score[] =>
  (db().prepare(`SELECT scorer_model, score, reason FROM ${table} WHERE candidate_id = ? ORDER BY score DESC`).all(candidateId) as { scorer_model: string; score: number; reason: string | null }[])
    .map((s) => ({ scorer: modelInfo(s.scorer_model).label, score: s.score, reason: s.reason }));

// hideAuthors: アイデアの作者を伏せている間（人が最初に承認するまで）は、作者を出さない
export function eventDetails(projectId: number, events: EventRow[], hideAuthors: boolean): Map<number, EventDetail> {
  const out = new Map<number, EventDetail>();
  for (const e of events) {
    if (e.kind === "select") {
      const mine = db().prepare("SELECT batch_id FROM idea_candidates WHERE project_id = ? LIMIT 1").get(projectId) as { batch_id: string } | undefined;
      if (!mine) continue;
      const rows = db().prepare("SELECT * FROM idea_candidates WHERE batch_id = ? ORDER BY avg_score DESC").all(mine.batch_id) as
        { id: number; label: string; title: string; author_model: string; avg_score: number | null; selected: number; project_id: number | null; payload: string }[];
      out.set(e.id, {
        type: "ideas",
        candidates: rows.map((r) => {
          const idea = JSON.parse(r.payload) as Record<string, string>;
          return {
            label: r.label, title: r.title, author: hideAuthors ? null : modelInfo(r.author_model).label, avg: r.avg_score,
            selected: !!r.selected, isThis: r.project_id === projectId,
            kind: idea.kind ?? null, target: idea.target ?? null, problem: idea.problem ?? null, solution: idea.solution ?? null, reason: idea.reason ?? null, channel: idea.channel ?? null,
            scores: scoresOf("idea_scores", r.id).map((s) => (hideAuthors ? { ...s, scorer: "AI" } : s)),
          };
        }),
      });
    }
    if (e.kind === "lp-select") {
      // そのときの版の候補（経過の時刻より前に作られた、いちばん新しい版）
      const v = db().prepare("SELECT version FROM lp_candidates WHERE project_id = ? AND at <= ? ORDER BY version DESC LIMIT 1").get(projectId, e.at) as { version: number } | undefined;
      if (!v) continue;
      const rows = db().prepare("SELECT * FROM lp_candidates WHERE project_id = ? AND version = ? ORDER BY label").all(projectId, v.version) as
        { id: number; label: string; author_model: string; avg_score: number | null; selected: number; human_selected: number; lp: string }[];
      out.set(e.id, {
        type: "lp",
        candidates: rows.map((r) => ({
          id: r.id, label: r.label, author: modelInfo(r.author_model).label, avg: r.avg_score, selected: !!r.selected, humanSelected: !!r.human_selected,
          headline: (JSON.parse(r.lp) as { headline?: string }).headline ?? "", scores: scoresOf("lp_candidate_scores", r.id),
        })),
      });
    }
    if (e.kind === "judge" || e.kind === "debate") {
      // 判断のすぐあとに記録した、各AIの判断の組（裏比較）。議論の経過は、その組の議論
      const round = db().prepare("SELECT round_id, approval_id FROM shadow_judgments WHERE project_id = ? AND is_primary = 1 AND at >= datetime(?, '-5 seconds') ORDER BY at LIMIT 1").get(projectId, e.at) as
        { round_id: number; approval_id: number | null } | undefined;
      if (!round) continue;
      const rows = db().prepare("SELECT * FROM shadow_judgments WHERE round_id = ? ORDER BY is_primary DESC, id").all(round.round_id) as ShadowRow[];
      const debateRow = db().prepare("SELECT payload FROM debates WHERE round_id = ? ORDER BY id DESC LIMIT 1").get(round.round_id) as { payload: string | null } | undefined;
      out.set(e.id, {
        type: "judge",
        rows: rows.map((r) => ({
          model: modelInfo(r.model_id).label, isPrimary: !!r.is_primary, decision: r.decision, confidence: r.confidence,
          reason: r.reason, nextAction: r.next_action, error: r.error,
        })),
        debate: debateRow?.payload ? (JSON.parse(debateRow.payload) as DebateResult) : round.approval_id ? debateFor(round.approval_id)?.result ?? null : null,
      });
    }
  }
  return out;
}
