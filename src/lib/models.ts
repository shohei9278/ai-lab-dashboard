// 比較対象のモデル一覧。料金は 100万トークンあたりの USD（2026-10-30 に公式ページで確認。gpt-6.2-sol は 2026-11-25 に確認）。
// 各社の最新世代から「上位」と「軽量」を1つずつ選んでいる。
//   Claude: https://docs.claude.com/en/docs/about-claude/pricing
//   OpenAI: https://developers.openai.com/api/docs/pricing
//   Gemini: https://ai.google.dev/gemini-api/docs/pricing
// モデルIDが実在するかは scripts/check-models.mts で確認できる。

export type Provider = "anthropic" | "openai" | "google";
export type Tier = "top" | "mid" | "light"; // mid = 上位と同じ会社の、安くて速いモデル（アイデア出しの3社には入れない）

export type ModelDef = {
  id: string;
  label: string;
  provider: Provider;
  tier: Tier;
  inputPerM: number;
  outputPerM: number;
  verified: boolean;
};

export const MODELS: ModelDef[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", tier: "top", inputPerM: 4, outputPerM: 20, verified: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", tier: "mid", inputPerM: 2, outputPerM: 10, verified: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", tier: "light", inputPerM: 0.1, outputPerM: 0.5, verified: true },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", tier: "top", inputPerM: 2, outputPerM: 10, verified: true },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", tier: "light", inputPerM: 0.2, outputPerM: 1.2, verified: true },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", provider: "google", tier: "top", inputPerM: 2, outputPerM: 12, verified: true },
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "google", tier: "light", inputPerM: 0.3, outputPerM: 2.5, verified: true },
];

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  google: "Gemini",
};

export const PROVIDER_ENV: Record<Provider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
};

// 一覧から外したモデルと、その代わり（運営者が決めた切り替え）
// - 設定や記録に残った古い ID で呼んでも、代わりのモデルで呼ぶ（getModel）
// - 過去の記録の表示は、古い名前のまま出す（modelInfo）
// - 交代の順番（担当した回数が少ないものに任せる）は、古い ID の回数も代わりのモデルの回数として数える（currentModelId）。
//   数えないと、代わりのモデルが回数0として、続けて何回も選ばれてしまう
// gpt-5.6-sol → gpt-6.2-sol: 2026-11-25。gpt-6.2-sol は新しく、料金が半分（$2 / $10）。gpt-5.6-sol の値下げは 11/30 までで、そのあとの料金は出ていなかった
export const RETIRED: Record<string, { label: string; provider: Provider; replacedBy: string }> = {
  "gpt-5.6-sol": { label: "GPT-5.6 Sol", provider: "openai", replacedBy: "gpt-6.2-sol" },
};
export const currentModelId = (id: string) => RETIRED[id]?.replacedBy ?? id;
// 「担当した回数」などの数を、いまのモデルの ID にまとめる
export function countByCurrent(rows: { m: string; n: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) out.set(currentModelId(r.m), (out.get(currentModelId(r.m)) ?? 0) + r.n);
  return out;
}

export function getModel(id: string): ModelDef {
  const m = MODELS.find((x) => x.id === currentModelId(id));
  if (!m) throw new Error(`unknown model: ${id}`);
  return m;
}

// 表示用。一覧から外したモデルの過去の結果も表示できるようにする
export function modelInfo(id: string): Pick<ModelDef, "id" | "label" | "provider" | "tier"> {
  const m = MODELS.find((x) => x.id === id);
  if (m) return m;
  const old = RETIRED[id];
  if (old) return { id, label: `${old.label}（旧）`, provider: old.provider, tier: "top" };
  if (id === "gpt-image-2") return { id, label: "GPT Image 2（画像）", provider: "openai", tier: "top" };
  if (id === "gemini-3.1-flash-image") return { id, label: "Gemini（画像）", provider: "google", tier: "light" };
  if (id === "claude-code") return { id, label: "Claude Code（開発）", provider: "anthropic", tier: "top" };
  if (id === "x-api") return { id, label: "X API（投稿・検索）", provider: "openai", tier: "light" };
  if (id === "threads-api") return { id, label: "Threads API（自動投稿）", provider: "openai", tier: "light" };
  if (id === "bluesky-api") return { id, label: "Bluesky（自動投稿）", provider: "openai", tier: "light" };
  const provider: Provider = id.startsWith("claude") ? "anthropic" : id.startsWith("gemini") ? "google" : "openai";
  return { id, label: `${id}（旧）`, provider, tier: "top" };
}

export function costUsd(model: ModelDef, inputTokens: number, outputTokens: number): number {
  return (inputTokens * model.inputPerM + outputTokens * model.outputPerM) / 1_000_000;
}

export function hasKey(provider: Provider): boolean {
  return Boolean(process.env[PROVIDER_ENV[provider]]);
}
