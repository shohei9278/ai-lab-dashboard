import { db, type ResultRow, type RunRow } from "./db";
import { modelInfo, type Provider, type Tier } from "./models";

// 95% Wilson 信頼区間
export function wilson(p: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export type ModelStats = {
  modelId: string;
  label: string;
  provider: Provider;
  tier: Tier;
  calls: number;
  items: number;
  accuracy: number; // 問題ごとの正解率の平均
  ci: [number, number];
  fieldScore: number; // 抽出の項目単位スコア
  consistency: number | null; // 繰り返し時に最頻回答と一致した割合（1回のみなら null）
  formatRate: number;
  refusalRate: number;
  apiErrors: number; // 集計から外した回数制限・通信エラーの件数
  avgLatencyMs: number;
  costUsd: number;
  costPerCallUsd: number;
  costPerCorrectUsd: number | null;
};

export type RunStats = {
  run: RunRow;
  models: ModelStats[];
  byAuthor: { author: string; items: number; accuracy: Record<string, number> }[];
  perItem: { itemId: string; author: string; rates: Record<string, number> }[];
  warnings: string[];
};

export function runStats(runId: number): RunStats | null {
  const run = db().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as RunRow | undefined;
  if (!run) return null;
  const allRows = db().prepare("SELECT * FROM results WHERE run_id = ?").all(runId) as ResultRow[];
  // 回数制限や通信エラーはAIの不正解ではないので集計から外す（回答拒否はAIの振る舞いなので残す）
  const isApiError = (r: ResultRow) => r.error !== null && r.error !== "refusal";
  const rows = allRows.filter((r) => !isApiError(r));
  const modelIds: string[] = JSON.parse(run.models);

  const models: ModelStats[] = modelIds.map((id) => {
    const m = modelInfo(id);
    const mine = rows.filter((r) => r.model_id === id);
    const apiErrors = allRows.filter((r) => r.model_id === id && isApiError(r)).length;
    const byItem = groupBy(mine, (r) => r.item_id);
    const itemAcc = [...byItem.values()].map((rs) => mean(rs.map((r) => r.correct)));
    const accuracy = mean(itemAcc);
    const consistency =
      run.reps > 1
        ? mean([...byItem.values()].map((rs) => {
            const counts = countBy(rs.map((r) => r.canonical ?? "__ERROR__"));
            return Math.max(...counts.values()) / rs.length;
          }))
        : null;
    const cost = sum(mine.map((r) => r.cost_usd));
    const correct = sum(mine.map((r) => r.correct));
    return {
      modelId: id,
      label: m.label,
      provider: m.provider,
      tier: m.tier,
      calls: mine.length,
      items: byItem.size,
      accuracy,
      ci: wilson(accuracy, byItem.size),
      fieldScore: mean(mine.map((r) => r.score)),
      consistency,
      formatRate: mean(mine.map((r) => r.format_ok)),
      refusalRate: mean(mine.map((r) => (r.error === "refusal" ? 1 : 0))),
      apiErrors,
      avgLatencyMs: mean(mine.map((r) => r.latency_ms)),
      costUsd: cost,
      costPerCallUsd: mine.length ? cost / mine.length : 0,
      costPerCorrectUsd: correct ? cost / correct : null,
    };
  });

  const authors = groupBy(rows, (r) => r.item_author);
  const byAuthor = [...authors.entries()].map(([author, rs]) => ({
    author,
    items: new Set(rs.map((r) => r.item_id)).size,
    accuracy: Object.fromEntries(modelIds.map((id) => [id, mean(rs.filter((r) => r.model_id === id).map((r) => r.correct))])),
  }));

  const items = groupBy(rows, (r) => r.item_id);
  const perItem = [...items.entries()]
    .map(([itemId, rs]) => ({
      itemId,
      author: rs[0].item_author,
      rates: Object.fromEntries(modelIds.map((id) => [id, mean(rs.filter((r) => r.model_id === id).map((r) => r.correct))])),
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));

  const warnings: string[] = [];
  const nItems = items.size;
  if (run.mock) warnings.push("ダミー実行の結果です。実際のモデルの実力とは関係ありません。");
  for (const m of models) {
    if (m.apiErrors === 0) continue;
    warnings.push(
      m.calls === 0
        ? `${m.label} は全${m.apiErrors}回がAPIエラーで、結果がありません（課金設定や回数制限を確認してください）。`
        : `${m.label} は${m.apiErrors}回がAPIエラーだったため、残り${m.calls}回で集計しています。`,
    );
  }
  const minAcc = Math.min(...models.filter((m) => m.calls > 0).map((m) => m.accuracy));
  if (models.some((m) => m.calls > 0) && minAcc >= 0.95) {
    warnings.push("全モデルの正答率が95%以上です。問題が簡単すぎて差が出ていない可能性があります。");
  }
  if (nItems > 0 && nItems < 30) {
    warnings.push(`問題数が${nItems}問と少ないため、正答率の差が約20ポイント未満なら誤差の可能性があります。`);
  } else if (nItems < 100 && nItems > 0) {
    warnings.push(`問題数が${nItems}問のため、10ポイント未満の差は誤差の可能性があります。`);
  }
  if (byAuthor.length === 1) warnings.push(`全問題の作成者が「${byAuthor[0].author}」です。作成したAIに有利な偏りがある可能性があります。`);

  return { run, models, byAuthor, perItem, warnings };
}

function mean(xs: number[]): number {
  return xs.length ? sum(xs) / xs.length : 0;
}
function sum(xs: number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}
function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(x);
  }
  return m;
}
function countBy(xs: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}
