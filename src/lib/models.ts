// 比較対象のモデル一覧。料金は 100万トークンあたりの USD（2026-10-30 に公式ページで確認）。
// 各社の最新世代から「上位」と「軽量」を1つずつ選んでいる。
//   Claude: https://docs.claude.com/en/docs/about-claude/pricing
//   OpenAI: https://developers.openai.com/api/docs/pricing
//   Gemini: https://ai.google.dev/gemini-api/docs/pricing
// モデルIDが実在するかは scripts/check-models.mts で確認できる。

export type Provider = "anthropic" | "openai" | "google";
export type Tier = "top" | "light";

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
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", tier: "light", inputPerM: 0.1, outputPerM: 0.5, verified: true },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", tier: "top", inputPerM: 4, outputPerM: 20, verified: true },
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

export function getModel(id: string): ModelDef {
  const m = MODELS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown model: ${id}`);
  return m;
}

// 表示用。一覧から外したモデルの過去の結果も表示できるようにする
export function modelInfo(id: string): Pick<ModelDef, "id" | "label" | "provider" | "tier"> {
  const m = MODELS.find((x) => x.id === id);
  if (m) return m;
  if (id === "gpt-image-2") return { id, label: "GPT Image 2（画像）", provider: "openai", tier: "top" };
  if (id === "gemini-3.1-flash-image") return { id, label: "Gemini（画像）", provider: "google", tier: "light" };
  if (id === "x-api") return { id, label: "X API（自動投稿）", provider: "openai", tier: "light" };
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
