import { createHash } from "node:crypto";
import { db, getSettings, monthSpendUsd } from "./db";
import { callJson, GuardError } from "./ai";
import { MODELS, costUsd, getModel, hasKey } from "./models";
import { isReview, lpReviewPrompt, withActivity, type Review } from "./loop";
import { CHECK_EVAL_CASES, CHECK_EVAL_TYPE_LABEL, checkEvalInput, type CheckEvalCase, type CheckEvalType } from "./checkEvalCases";

// 公開前チェックの評価。正解の決まった例を、本番と同じ指示（lpReviewPrompt）でチェックさせ、
// 「問題ありを見逃した数」と「問題なしを止めた数」を数える。結果は案件には使わず、社員の声にも残さない（費用は ai_calls に入る）

const PURPOSE = "チェックの評価";
const PARALLEL = 3;
const OUTPUT_TOKENS = 400; // 1件あたりの出力の見込み（費用の見積もり用）

export type CheckEvalRow = { id: number; at: string; finished_at: string | null; model_id: string; prompt_hash: string; status: "running" | "done" | "error"; cost_usd: number | null; error: string | null; beat_at?: string | null };
export type CheckEvalResultRow = { eval_id: number; case_id: string; expect: "ok" | "ng"; type: CheckEvalType | null; got_ok: number | null; issues: string | null; error: string | null };

// 判定できるAI（上位のAIのうち、キーがあるもの。製品ループで使っているAIを先頭に）
export function checkEvalModels(): string[] {
  const loop = getSettings().loopModel;
  const ids = MODELS.filter((m) => m.tier === "top" && hasKey(m.provider)).map((m) => m.id);
  return [...new Set([loop, ...ids])].filter((id) => hasKey(getModel(id).provider));
}

// チェックの指示と例の指紋。全部の例を、渡す文の全体（system と user）と正解にして作る
// （指示・LPの渡し方・例のどれかを変えると変わる。変える前の結果とは、そのまま比べられないため）
export function checkPromptHash(): string {
  const texts = CHECK_EVAL_CASES.map((c) => { const { project, lp } = checkEvalInput(c); const p = lpReviewPrompt(project, lp); return `${c.id}|${c.expect}|${c.type ?? ""}\n${p.system}\n===\n${p.user}`; });
  return createHash("sha256").update(texts.join("\n---\n")).digest("hex").slice(0, 8);
}

// 1周の費用の見込み（円）。日本語は1文字を約1トークンとして多めに見積もる
export function estimateCheckEvalJpy(modelId: string): number {
  const m = getModel(modelId);
  const inputTokens = CHECK_EVAL_CASES.reduce((n, c) => { const { project, lp } = checkEvalInput(c); const p = lpReviewPrompt(project, lp); return n + p.system.length + p.user.length; }, 0);
  return Math.ceil(costUsd(m, inputTokens, OUTPUT_TOKENS * CHECK_EVAL_CASES.length) * getSettings().usdJpy);
}

// このサーバーの中で、いま実際に動いている評価。サーバーが再起動すると空になる
const active = new Set<number>();
// 動いている印（最後に例を1件終えた日時。まだなら始めた日時）がこれより古く、このサーバーの中でも動いていない評価は、
// サーバーの再起動などで処理が消えたものとして閉じる。閉じておかないと、次の評価を始められなくなる。
// このサーバーの中で動いている評価は、遅くても閉じない（閉じると、元の処理が続いたまま次の評価と並んで動いてしまう）
const STALE_MINUTES = 10;

export function runningCheckEval(): CheckEvalRow | undefined {
  const stale = db().prepare(`SELECT id FROM check_evals WHERE status = 'running' AND COALESCE(beat_at, at) < datetime('now', '-${STALE_MINUTES} minutes')`).all() as { id: number }[];
  for (const { id } of stale) if (!active.has(id)) finish(id, "error", "途中で止まった（サーバーの再起動などで処理が消えた）");
  return db().prepare("SELECT * FROM check_evals WHERE status = 'running' ORDER BY id DESC LIMIT 1").get() as CheckEvalRow | undefined;
}

const isRunning = (id: number) => (db().prepare("SELECT status FROM check_evals WHERE id = ?").get(id) as { status: string } | undefined)?.status === "running";

export function startCheckEval(modelId: unknown): number {
  const s = getSettings();
  if (typeof modelId !== "string" || !checkEvalModels().includes(modelId)) throw new Error("このAIでは評価できません（上位のAIで、APIキーがあるものだけ）");
  if (s.killSwitch) throw new Error("緊急停止中のため、評価できません");
  const cost = estimateCheckEvalJpy(modelId);
  // 動いている評価の確認・予算の確認・行の追加を1つのトランザクションにして、2つ同時に始まらないようにする
  const id = db().transaction(() => {
    if (runningCheckEval()) throw new Error("ほかの評価が動いています。終わってから実行してください");
    if (monthSpendUsd() * s.usdJpy + cost > s.monthlyBudgetJpy) throw new Error(`今月の予算の残りが、評価1回分（約${cost}円）に足りません`);
    return Number(db().prepare("INSERT INTO check_evals (model_id, prompt_hash) VALUES (?, ?)").run(modelId, checkPromptHash()).lastInsertRowid);
  }).immediate();
  // 動いている間は「いまAIがやっていること」に出す（右下の表示・オフィス・マージ前の確認に出るように）
  void withActivity({ key: `check-eval-${id}`, title: "公開前チェックの評価", models: [modelId], room: "dev", doing: "公開前チェックの評価", projectId: null }, () => runCheckEval(id, modelId)).catch((e) => finish(id, "error", e instanceof Error ? e.message : String(e)));
  return id;
}

// この評価で使った費用（始めてから、評価の目的でそのAIを呼んだ合計）
function spentOn(id: number): number {
  const r = db().prepare("SELECT at, model_id FROM check_evals WHERE id = ?").get(id) as { at: string; model_id: string };
  return (db().prepare("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM ai_calls WHERE purpose = ? AND model_id = ? AND at >= ?").get(PURPOSE, r.model_id, r.at) as { s: number }).s;
}

async function judgeOne(id: number, c: CheckEvalCase, modelId: string) {
  const { project, lp } = checkEvalInput(c);
  // 閉じたあとの評価には、結果を足さない
  const save = (gotOk: number | null, issues: string[] | null, error: string | null) => {
    if (!isRunning(id)) return;
    db().prepare("INSERT OR REPLACE INTO check_eval_results (eval_id, case_id, expect, type, got_ok, issues, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(id, c.id, c.expect, c.type ?? null, gotOk, issues ? JSON.stringify(issues) : null, error);
    db().prepare("UPDATE check_evals SET beat_at = datetime('now') WHERE id = ?").run(id);
  };
  try {
    const out = await callJson<Review>({ purpose: PURPOSE, modelId, ...lpReviewPrompt(project, lp), validate: isReview });
    save(out.ok ? 1 : 0, out.issues, null);
  } catch (e) {
    if (e instanceof GuardError) throw e; // 緊急停止・予算切れは、残りを流さずに止める
    save(null, null, (e instanceof Error ? e.message : String(e)).slice(0, 300));
  }
}

function finish(id: number, status: "done" | "error", error: string | null = null) {
  db().prepare("UPDATE check_evals SET status = ?, error = ?, finished_at = datetime('now'), cost_usd = ? WHERE id = ? AND status = 'running'")
    .run(status, error?.slice(0, 300) ?? null, spentOn(id), id);
}

// 緊急停止・予算切れ（GuardError）が出たら、ほかの並びは新しい例を取らずに止まり、呼び出し中のものが終わるのを待ってから閉じる
// （閉じたあとに結果や費用が増えないように）
export async function runCheckEval(id: number, modelId: string) {
  const queue = [...CHECK_EVAL_CASES];
  let stop: Error | null = null;
  active.add(id);
  // 閉じられた評価（別のサーバーが止まったと見なした など）は、新しい例を取らずに終える
  const worker = async () => {
    for (let c = queue.shift(); c && !stop && isRunning(id); c = queue.shift()) {
      try {
        await judgeOne(id, c, modelId);
      } catch (e) {
        stop = e instanceof Error ? e : new Error(String(e));
      }
    }
  };
  try {
    await Promise.allSettled(Array.from({ length: PARALLEL }, worker));
  } finally {
    active.delete(id);
  }
  if (stop) finish(id, "error", (stop as Error).message);
  else finish(id, "done");
}

export type CheckEvalSummary = {
  run: CheckEvalRow;
  ng: { total: number; caught: number; missed: number };
  ok: { total: number; passed: number; blocked: number };
  failed: number; // 答えが取れなかった例
  byType: { type: CheckEvalType; label: string; total: number; caught: number }[];
  misses: { caseId: string; type: CheckEvalType | null; note: string }[]; // 見逃した例
  overblocks: { caseId: string; note: string; issues: string[] }[]; // 止めすぎた例
  failures: { caseId: string; note: string; error: string }[]; // 答えが取れなかった例と、その理由
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
    failures: rows.filter((r) => r.got_ok === null).map((r) => ({ caseId: r.case_id, note: note(r.case_id), error: r.error ?? "理由は残っていません" })),
  };
}

export const CHECK_EVAL_HISTORY = 30;

// 画面用: AIごとの最新の結果（全期間から）と、直近の評価の一覧
export function checkEvalOverview() {
  const running = runningCheckEval();
  const runs = db().prepare("SELECT * FROM check_evals WHERE status != 'running' ORDER BY id DESC LIMIT ?").all(CHECK_EVAL_HISTORY) as CheckEvalRow[];
  const latest = db().prepare("SELECT * FROM check_evals WHERE id IN (SELECT MAX(id) FROM check_evals WHERE status = 'done' GROUP BY model_id) ORDER BY id DESC").all() as CheckEvalRow[];
  const results = (id: number) => db().prepare("SELECT * FROM check_eval_results WHERE eval_id = ?").all(id) as CheckEvalResultRow[];
  return {
    cases: { total: CHECK_EVAL_CASES.length, ng: CHECK_EVAL_CASES.filter((c) => c.expect === "ng").length, ok: CHECK_EVAL_CASES.filter((c) => c.expect === "ok").length },
    promptHash: checkPromptHash(),
    latest: latest.map((r) => summarizeCheckEval(r, results(r.id))),
    history: runs.map((r) => summarizeCheckEval(r, results(r.id))),
    running: running ? { run: running, done: (db().prepare("SELECT COUNT(*) AS n FROM check_eval_results WHERE eval_id = ?").get(running.id) as { n: number }).n } : null,
  };
}
