import { db, getSettings, monthSpendUsd, type RunRow } from "./db";
import { costUsd, getModel, hasKey } from "./models";
import { callModel } from "./providers";
import { DATASETS, buildPrompt, grade, type PromptLang, type PromptVariant, type TaskType } from "./tasks";

export type RunConfig = {
  task: TaskType;
  models: string[];
  reps: number;
  variant: PromptVariant;
  lang: PromptLang;
  mock: boolean;
  note?: string;
};

const CONCURRENCY = 4;
// 実測がないときの、思考トークン込みの出力量の見込み（多めに見積もる）
const EST_THINK_TOKENS = { top: 200, mid: 150, light: 100 } as const;
// 実測があるときも、プロンプトや問題の違いで増えることがあるので余裕を持たせる
const MEASURED_MARGIN = 1.5;

// 同じモデル・タスク・プロンプトの過去の実API結果から、1回あたりの平均トークン数を取る
function measuredTokens(cfg: RunConfig, modelId: string) {
  const row = db()
    .prepare(
      `SELECT COUNT(*) AS n, AVG(r.input_tokens) AS inTok, AVG(r.output_tokens) AS outTok
       FROM results r JOIN runs u ON u.id = r.run_id
       WHERE u.mock = 0 AND r.error IS NULL AND r.model_id = ? AND u.task = ? AND u.variant = ? AND u.lang = ?`,
    )
    .get(modelId, cfg.task, cfg.variant, cfg.lang) as { n: number; inTok: number; outTok: number };
  return row.n >= 5 ? row : null;
}

export function estimate(cfg: RunConfig) {
  const ds = DATASETS[cfg.task];
  const perModel = cfg.models.map((id) => {
    const m = getModel(id);
    const measured = measuredTokens(cfg, id);
    let input = 0;
    let output = 0;
    if (measured) {
      input = measured.inTok * ds.items.length * MEASURED_MARGIN;
      output = measured.outTok * ds.items.length * MEASURED_MARGIN;
    } else {
      for (const item of ds.items) {
        const p = buildPrompt(ds, item, cfg.variant, cfg.lang);
        input += Math.round((p.system.length + p.user.length) * 1.1);
        output += JSON.stringify(item.answer).length + EST_THINK_TOKENS[m.tier];
      }
    }
    const usd = costUsd(m, input, output) * cfg.reps;
    return { modelId: id, calls: ds.items.length * cfg.reps, usd, measured: Boolean(measured) };
  });
  const usd = perModel.reduce((s, x) => s + x.usd, 0);
  return { calls: perModel.reduce((s, x) => s + x.calls, 0), usd, perModel };
}

export function validate(cfg: RunConfig): string | null {
  if (!DATASETS[cfg.task]) return "タスクが不正です";
  if (cfg.models.length === 0) return "モデルを1つ以上選んでください";
  if (!Number.isInteger(cfg.reps) || cfg.reps < 1 || cfg.reps > 20) return "繰り返し回数は1〜20回にしてください";
  const s = getSettings();
  if (s.killSwitch) return "緊急停止中です。設定画面で解除してください";
  if (!cfg.mock) {
    const missing = cfg.models.map(getModel).filter((m) => !hasKey(m.provider));
    if (missing.length) return `APIキーがありません: ${missing.map((m) => m.label).join(", ")}`;
    const spentJpy = monthSpendUsd() * s.usdJpy;
    const estJpy = estimate(cfg).usd * s.usdJpy;
    if (spentJpy + estJpy > s.monthlyBudgetJpy) {
      return `月間予算を超えます（今月 ${Math.round(spentJpy)}円 + 見積 ${Math.round(estJpy)}円 > 上限 ${s.monthlyBudgetJpy}円）`;
    }
  }
  return null;
}

export function createRun(cfg: RunConfig): number {
  const ds = DATASETS[cfg.task];
  const est = estimate(cfg);
  const info = db()
    .prepare(
      `INSERT INTO runs (task, models, reps, variant, lang, mock, status, total_calls, estimate_usd, note)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .run(cfg.task, JSON.stringify(cfg.models), cfg.reps, cfg.variant, cfg.lang, cfg.mock ? 1 : 0,
      ds.items.length * cfg.reps * cfg.models.length, est.usd, cfg.note ?? null);
  const id = Number(info.lastInsertRowid);
  void executeRun(id).catch((e) => {
    db().prepare("UPDATE runs SET status = 'error', error = ?, finished_at = datetime('now') WHERE id = ?")
      .run(String(e).slice(0, 500), id);
  });
  return id;
}

async function executeRun(runId: number) {
  const conn = db();
  const run = conn.prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow;
  const ds = DATASETS[run.task as TaskType];
  const models: string[] = JSON.parse(run.models);
  conn.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId);

  const jobs = models.flatMap((modelId) =>
    ds.items.flatMap((item) => Array.from({ length: run.reps }, (_, rep) => ({ modelId, item, rep }))),
  );
  const insert = conn.prepare(
    `INSERT INTO results (run_id, model_id, item_id, item_author, rep, output, input_tokens, output_tokens,
       latency_ms, cost_usd, error, format_ok, correct, score, canonical)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const progress = conn.prepare("UPDATE runs SET done_calls = done_calls + 1, actual_usd = actual_usd + ? WHERE id = ?");

  let stopReason: string | null = null;
  let next = 0;

  const shouldStop = (): string | null => {
    const s = getSettings();
    if (s.killSwitch) return "緊急停止ボタンで停止しました";
    if (!run.mock && monthSpendUsd() * s.usdJpy > s.monthlyBudgetJpy) return "月間予算の上限に達したため停止しました";
    return null;
  };

  const worker = async () => {
    while (next < jobs.length && !stopReason) {
      stopReason = shouldStop();
      if (stopReason) break;
      const job = jobs[next++];
      const model = getModel(job.modelId);
      const prompt = buildPrompt(ds, job.item, run.variant as PromptVariant, run.lang as PromptLang);
      const r = await callModel(model, prompt, run.mock ? { ds, item: job.item, rep: job.rep } : null);
      const g = r.error ? { formatOk: false, correct: false, score: 0, canonical: null } : grade(ds, job.item, r.text);
      const cost = costUsd(model, r.inputTokens, r.outputTokens);
      insert.run(runId, job.modelId, job.item.id, job.item.author, job.rep, r.text, r.inputTokens, r.outputTokens,
        r.latencyMs, cost, r.error ?? null, g.formatOk ? 1 : 0, g.correct ? 1 : 0, g.score, g.canonical);
      progress.run(cost, runId);
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  conn.prepare("UPDATE runs SET status = ?, error = ?, finished_at = datetime('now') WHERE id = ?")
    .run(stopReason ? "stopped" : "done", stopReason, runId);
}
