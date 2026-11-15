import { createHash } from "node:crypto";
import { db, getSettings, monthSpendUsd } from "./db";
import { callJson, GuardError } from "./ai";
import { MODELS, costUsd, getModel, hasKey } from "./models";
import { isReview, lpReviewPrompt, type Review } from "./loop";
import { CHECK_EVAL_CASES, CHECK_EVAL_TYPE_LABEL, checkEvalInput, type CheckEvalCase, type CheckEvalType } from "./checkEvalCases";

// 公開前チェックの評価。正解の決まった例を、本番と同じ指示（lpReviewPrompt）でチェックさせ、
// 「問題ありを見逃した数」と「問題なしを止めた数」を数える。結果は案件には使わず、社員の声にも残さない（費用は ai_calls に入る）

const PURPOSE = "チェックの評価";
const PARALLEL = 3;
const OUTPUT_TOKENS = 400; // 1件あたりの出力の見込み（費用の見積もり用）

export type CheckEvalRow = { id: number; at: string; finished_at: string | null; model_id: string; prompt_hash: string; status: "running" | "done" | "error"; cost_usd: number | null; error: string | null };
export type CheckEvalResultRow = { eval_id: number; case_id: string; expect: "ok" | "ng"; type: CheckEvalType | null; got_ok: number | null; issues: string | null; error: string | null };

// 判定できるAI（上位のAIのうち、キーがあるもの。製品ループで使っているAIを先頭に）
export function checkEvalModels(): string[] {
  const loop = getSettings().loopModel;
  const ids = MODELS.filter((m) => m.tier === "top" && hasKey(m.provider)).map((m) => m.id);
  return [...new Set([loop, ...ids])].filter((id) => hasKey(getModel(id).provider));
}

// チェックの指示の指紋。事前登録LPとツールの両方の指示から作る（指示を変えた前後の結果を見分けるため）
export function checkPromptHash(): string {
  const pick = (kind: "lp" | "tool") => CHECK_EVAL_CASES.find((c) => checkEvalInput(c).project.kind === kind)!;
  const systems = (["lp", "tool"] as const).map((k) => { const { project, lp } = checkEvalInput(pick(k)); return lpReviewPrompt(project, lp).system; });
  return createHash("sha256").update(systems.join("\n---\n")).digest("hex").slice(0, 8);
}

// 1周の費用の見込み（円）。日本語は1文字を約1トークンとして多めに見積もる
export function estimateCheckEvalJpy(modelId: string): number {
  const m = getModel(modelId);
  const inputTokens = CHECK_EVAL_CASES.reduce((n, c) => { const { project, lp } = checkEvalInput(c); const p = lpReviewPrompt(project, lp); return n + p.system.length + p.user.length; }, 0);
  return Math.ceil(costUsd(m, inputTokens, OUTPUT_TOKENS * CHECK_EVAL_CASES.length) * getSettings().usdJpy);
}

export function runningCheckEval(): CheckEvalRow | undefined {
  return db().prepare("SELECT * FROM check_evals WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as CheckEvalRow | undefined;
}

export function startCheckEval(modelId: unknown): number {
  const s = getSettings();
  if (typeof modelId !== "string" || !checkEvalModels().includes(modelId)) throw new Error("このAIでは評価できません（上位のAIで、APIキーがあるものだけ）");
  if (s.killSwitch) throw new Error("緊急停止中のため、評価できません");
  if (runningCheckEval()) throw new Error("ほかの評価が動いています。終わってから実行してください");
  const cost = estimateCheckEvalJpy(modelId);
  if (monthSpendUsd() * s.usdJpy + cost > s.monthlyBudgetJpy) throw new Error(`今月の予算の残りが、評価1回分（約${cost}円）に足りません`);
  const id = Number(db().prepare("INSERT INTO check_evals (model_id, prompt_hash) VALUES (?, ?)").run(modelId, checkPromptHash()).lastInsertRowid);
  void runCheckEval(id, modelId).catch((e) => {
    db().prepare("UPDATE check_evals SET status = 'error', error = ?, finished_at = datetime('now'), cost_usd = ? WHERE id = ? AND status = 'running'")
      .run((e instanceof Error ? e.message : String(e)).slice(0, 300), spentOn(id), id);
  });
  return id;
}

// この評価で使った費用（始めてから、評価の目的でそのAIを呼んだ合計）
function spentOn(id: number): number {
  const r = db().prepare("SELECT at, model_id FROM check_evals WHERE id = ?").get(id) as { at: string; model_id: string };
  return (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE purpose = ? AND model_id = ? AND at >= ?").get(PURPOSE, r.model_id, r.at) as { s: number }).s;
}

async function judgeOne(id: number, c: CheckEvalCase, modelId: string) {
  const { project, lp } = checkEvalInput(c);
  const save = (gotOk: number | null, issues: string[] | null, error: string | null) =>
    db().prepare("INSERT OR REPLACE INTO check_eval_results (eval_id, case_id, expect, type, got_ok, issues, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, c.id, c.expect, c.type ?? null, gotOk, issues ? JSON.stringify(issues) : null, error);
  try {
    const out = await callJson<Review>({ purpose: PURPOSE, modelId, ...lpReviewPrompt(project, lp), validate: isReview });
    save(out.ok ? 1 : 0, out.issues, null);
  } catch (e) {
    if (e instanceof GuardError) throw e; // 緊急停止・予算切れは、残りを流さずに止める
    save(null, null, (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
}

export async function runCheckEval(id: number, modelId: string) {
  const queue = [...CHECK_EVAL_CASES];
  const worker = async () => { for (let c = queue.shift(); c; c = queue.shift()) await judgeOne(id, c, modelId); };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  db().prepare("UPDATE check_evals SET status = 'done', finished_at = datetime('now'), cost_usd = ? WHERE id = ? AND status = 'running'").run(spentOn(id), id);
}

export type CheckEvalSummary = {
  run: CheckEvalRow;
  ng: { total: number; caught: number; missed: number };
  ok: { total: number; passed: number; blocked: number };
  failed: number; // 答えが取れなかった例
  byType: { type: CheckEvalType; label: string; total: number; caught: number }[];
  misses: { caseId: string; type: CheckEvalType | null; note: string }[]; // 見逃した例
  overblocks: { caseId: string; note: string; issues: string[] }[]; // 止めすぎた例
};

export function summarizeCheckEval(run: CheckEvalRow, rows: CheckEvalResultRow[]): CheckEvalSummary {
  const note = (id: string) => CHECK_EVAL_CASES.find((c) => c.id === id)?.note ?? id;
  const answered = rows.filter((r) => r.got_ok !== null);
  const ng = answered.filter((r) => r.expect === "ng");
  const ok = answered.filter((r) => r.expect === "ok");
  const types = Object.keys(CHECK_EVAL_TYPE_LABEL) as CheckEvalType[];
  return {
    run,
    ng: { total: ng.length, caught: ng.filter((r) => r.got_ok === 0).length, missed: ng.filter((r) => r.got_ok === 1).length },
    ok: { total: ok.length, passed: ok.filter((r) => r.got_ok === 1).length, blocked: ok.filter((r) => r.got_ok === 0).length },
    failed: rows.length - answered.length,
    byType: types.map((type) => {
      const t = ng.filter((r) => r.type === type);
      return { type, label: CHECK_EVAL_TYPE_LABEL[type], total: t.length, caught: t.filter((r) => r.got_ok === 0).length };
    }),
    misses: ng.filter((r) => r.got_ok === 1).map((r) => ({ caseId: r.case_id, type: r.type, note: note(r.case_id) })),
    overblocks: ok.filter((r) => r.got_ok === 0).map((r) => ({ caseId: r.case_id, note: note(r.case_id), issues: r.issues ? (JSON.parse(r.issues) as string[]) : [] })),
  };
}

// 画面用: AIごとの最新の結果と、これまでの評価の一覧
export function checkEvalOverview() {
  const runs = db().prepare("SELECT * FROM check_evals ORDER BY id DESC LIMIT 30").all() as CheckEvalRow[];
  const results = (id: number) => db().prepare("SELECT * FROM check_eval_results WHERE eval_id = ?").all(id) as CheckEvalResultRow[];
  const latestByModel = new Map<string, CheckEvalRow>();
  for (const r of runs) if (r.status === "done" && !latestByModel.has(r.model_id)) latestByModel.set(r.model_id, r);
  const running = runs.find((r) => r.status === "running");
  return {
    cases: { total: CHECK_EVAL_CASES.length, ng: CHECK_EVAL_CASES.filter((c) => c.expect === "ng").length, ok: CHECK_EVAL_CASES.filter((c) => c.expect === "ok").length },
    promptHash: checkPromptHash(),
    latest: [...latestByModel.values()].map((r) => summarizeCheckEval(r, results(r.id))),
    history: runs.filter((r) => r.status !== "running").map((r) => summarizeCheckEval(r, results(r.id))),
    running: running ? { run: running, done: (db().prepare("SELECT COUNT(*) AS n FROM check_eval_results WHERE eval_id = ?").get(running.id) as { n: number }).n } : null,
  };
}
