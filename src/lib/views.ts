import type { ApprovalView } from "@/components/ApprovalCard";
import { db, getSettings, type ApprovalRow, type ProjectRow } from "./db";
import { CONV, debateFor, projectTotals, shadowModels, targetRate, type Decision, type Review, type ShadowRow } from "./loop";
import { modelInfo } from "./models";

// 承認待ちを、カードに表示できる形にまとめる
export function pendingApprovals(projectId?: number): ApprovalView[] {
  const rows = db()
    .prepare(
      `SELECT a.*, p.title, p.target, p.problem, p.solution, p.hypothesis, p.ai_confidence, p.demo, p.kind AS product_kind, p.lp_version, p.public_version
       FROM approvals a JOIN projects p ON p.id = a.project_id
       WHERE a.status = 'pending' ${projectId ? "AND a.project_id = ?" : ""}
       ORDER BY a.id`,
    )
    .all(...(projectId ? [projectId] : [])) as (ApprovalRow & Pick<ProjectRow, "title" | "target" | "problem" | "solution" | "hypothesis" | "ai_confidence" | "demo" | "lp_version" | "public_version"> & { product_kind: ProjectRow["kind"] })[];
  const s = getSettings();
  return rows.map((r) => {
    const d = r.kind === "decision" && r.payload ? (JSON.parse(r.payload) as Decision) : null;
    const review = r.kind === "publish" && r.payload ? (JSON.parse(r.payload) as { review?: Review }).review : undefined;
    const t = r.kind === "decision" ? projectTotals(r.project_id) : null;
    return {
      id: r.id,
      kind: r.kind,
      proposal: r.proposal,
      reason: r.reason,
      createdAt: r.created_at,
      project: {
        id: r.project_id, title: r.title, target: r.target, problem: r.problem, solution: r.solution,
        hypothesis: r.hypothesis, confidence: r.ai_confidence, demo: !!r.demo, kind: r.product_kind, lpVersion: r.lp_version, publicVersion: r.public_version,
      },
      decision: d ? { confidence: d.confidence, nextAction: d.next_action } : undefined,
      review,
      totals: t ? { visits: t.visits, signups: t.signups, rate: t.rate, adSpendJpy: t.adSpendJpy, simulated: t.simulated } : undefined,
      targetRate: targetRate(r.product_kind, s),
      conv: CONV[r.product_kind],
      judge: d ? judgeView(r, d) : undefined,
    };
  });
}

// 判断カードの2段階目に出す情報。最初の判断を記録するまでは、他のAIの意見も議論も渡さない
function judgeView(a: ApprovalRow, d: Decision): ApprovalView["judge"] {
  const s = getSettings();
  const revealed = !!a.initial_choice;
  const rows = revealed
    ? (db().prepare("SELECT * FROM shadow_judgments WHERE approval_id = ? AND is_primary = 0").all(a.id) as ShadowRow[])
    : [];
  const debate = revealed ? debateFor(a.id) : null;
  const label = (id: string) => modelInfo(id).label;
  const provider = (id: string) => modelInfo(id).provider;
  const primary = db().prepare("SELECT model_id FROM shadow_judgments WHERE approval_id = ? AND is_primary = 1").get(a.id) as { model_id: string } | undefined;
  return {
    adBudgetJpy: s.adBudgetPerProjectJpy,
    lpVersion: a.lp_version,
    primaryModel: label(primary?.model_id ?? s.loopModel),
    primaryDecision: d.decision,
    initialChoice: a.initial_choice,
    others: rows.map((r) => ({ modelId: r.model_id, label: label(r.model_id), provider: provider(r.model_id), decision: r.decision, confidence: r.confidence, reason: r.reason, error: r.error })),
    // 裏比較が有効なのに、まだ他のAIの答えが揃っていない
    // （裏比較を始める前の古い承認待ちやデモは、待っても揃わないので待たない）
    othersPending: revealed && s.shadowJudge && !!primary && rows.length < shadowModels().length,
    debate: debate
      ? {
          status: debate.status,
          issue: debate.result?.issue,
          missingInfo: debate.result?.missing_info,
          positions: debate.result?.positions.map((p) => ({ label: label(p.modelId), provider: provider(p.modelId), first: p.first, final: p.final, argument: p.argument, changed: p.changed })),
        }
      : null,
  };
}

// 人がまだ最初の判断を選んでいない案件では、AIの判断内容や議論が記録から見えないように伏せる
const REVEALING_KINDS = new Set(["judge", "debate", "auto-blocked"]);

export function maskEvents<T extends { project_id: number | null; kind: string; message: string }>(events: T[]): T[] {
  const hidden = new Set(
    (db()
      .prepare("SELECT DISTINCT project_id FROM approvals WHERE kind = 'decision' AND status = 'pending' AND initial_choice IS NULL")
      .all() as { project_id: number }[]).map((r) => r.project_id),
  );
  return events.map((e) =>
    e.project_id !== null && hidden.has(e.project_id) && REVEALING_KINDS.has(e.kind)
      ? { ...e, message: "AIが判断しました（内容は、あなたが最初の判断を選んだあとに表示されます）" }
      : e,
  );
}

export function pendingCount(): number {
  return (db().prepare("SELECT COUNT(*) AS n FROM approvals WHERE status = 'pending'").get() as { n: number }).n;
}
