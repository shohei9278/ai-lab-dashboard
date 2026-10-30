export const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;

export const yen = (usd: number, usdJpy: number) => {
  const v = usd * usdJpy;
  if (v === 0) return "0円";
  if (v < 1) return `${v.toFixed(2)}円`;
  if (v < 100) return `${v.toFixed(1)}円`;
  return `${Math.round(v).toLocaleString("ja-JP")}円`;
};

export const ms = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(1)}秒` : `${Math.round(x)}ms`);

export const STATUS_LABEL: Record<string, string> = {
  queued: "待機中",
  running: "実行中",
  done: "完了",
  stopped: "停止",
  error: "エラー",
};

export const AUTHOR_LABEL: Record<string, string> = {
  human: "人間",
  claude: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
};
