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

// 時刻の表示は日本時間にそろえる。DBの時刻は UTC の "YYYY-MM-DD HH:MM:SS"、ほかに ISO（…Z）もある
// サーバーとブラウザで結果が変わらないよう、地域の設定に頼らず +9時間して組み立てる
function jstParts(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + 9 * 3_600_000).toISOString(); // この文字列の「時刻」が日本時間
}
export const jstDateTime = (s: string | null | undefined) => jstParts(s)?.slice(5, 16).replace("T", " ") ?? "—"; // MM-DD HH:MM
export const jstFull = (s: string | null | undefined) => jstParts(s)?.slice(0, 16).replace("T", " ") ?? "—"; // YYYY-MM-DD HH:MM
export const jstDate = (s: string | null | undefined) => jstParts(s)?.slice(0, 10) ?? "—"; // YYYY-MM-DD
export const jstMonthDay = (s: string | null | undefined) => jstParts(s)?.slice(5, 10) ?? "—"; // MM-DD
