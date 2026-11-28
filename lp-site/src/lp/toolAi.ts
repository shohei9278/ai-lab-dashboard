// その場で AI を呼ぶ窓口（window.labAi）の決まり。ダッシュボードと公開サイトの両方で使う（docs/design-tool-limits.md の ③）
// - AIへの指示（instruction）は、ツールのコードには書かせず、ツールを入れるときに <script type="application/json" id="lab-ai"> で添えて、別に持つ
// - 指示は、人が公開を承認したときに、そのツールのコードに結び付けて承認する（ダッシュボードの src/lib/toolAi.ts）。コードが変われば承認し直す
// - 公開サイトの中身（Supabase の lps.content）には、承認された指示だけが入る。読むとき（normalizeLp）に長さの上限だけを残すので、
//   訪問者の画面（ページ・ツールの枠）には、指示の本文は渡らない（指示を読むのは、公開サイトのサーバーだけ）
// 外部のライブラリを読み込まない（ダッシュボードと公開サイトの両方から読む）

export const TOOL_AI_INSTRUCTION_MAX = 2000;
// 訪問者の入力の長さの上限として選べる最大（文字）
export const TOOL_AI_INPUT_MAX = 500;
// AIの答えの長さの上限として選べる最大（文字）
export const TOOL_AI_OUTPUT_MAX = 600;

export type ToolAiLimits = { inputMax: number; outputMax: number };
export type ToolAiSpec = ToolAiLimits & { instruction: string };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const okInt = (v: unknown, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;

// 長さの上限だけを読む（公開サイトの画面で使う）。形が違えば使わない
export function toolAiLimitsOf(v: unknown): ToolAiLimits | undefined {
  if (!isObj(v) || !okInt(v.inputMax, TOOL_AI_INPUT_MAX) || !okInt(v.outputMax, TOOL_AI_OUTPUT_MAX)) return undefined;
  return { inputMax: v.inputMax, outputMax: v.outputMax };
}

// 添えられた AI への指示を確かめる。正しければ指示、だめなら理由（ツールを入れる人に返す）
// 指示の前後の空白は落とす（中の改行は残す）。長さの上限を超えるものは切らずに理由を返す（切ると意味が変わるため）
export function toolAiSpecOf(v: unknown): ToolAiSpec | string {
  if (!isObj(v)) return "AIへの指示（lab-ai）は、{\"instruction\": …, \"inputMax\": …, \"outputMax\": …} の形の JSON にしてください";
  const instruction = typeof v.instruction === "string" ? v.instruction.trim() : "";
  if (!instruction) return "AIへの指示（lab-ai）の instruction（どう答えるか）が空です";
  if (instruction.length > TOOL_AI_INSTRUCTION_MAX) return `AIへの指示（lab-ai）の instruction が長すぎます（${instruction.length}文字。${TOOL_AI_INSTRUCTION_MAX}文字まで）`;
  if (!okInt(v.inputMax, TOOL_AI_INPUT_MAX)) return `AIへの指示（lab-ai）の inputMax（訪問者の入力の長さの上限）は、1〜${TOOL_AI_INPUT_MAX} の整数にしてください`;
  if (!okInt(v.outputMax, TOOL_AI_OUTPUT_MAX)) return `AIへの指示（lab-ai）の outputMax（答えの長さの上限）は、1〜${TOOL_AI_OUTPUT_MAX} の整数にしてください`;
  return { instruction, inputMax: v.inputMax, outputMax: v.outputMax };
}

// ツールのコードが、その場で AI を呼ぶ窓口を使っているか
export const usesToolAi = (html: string): boolean => /\blabAi\b/.test(html);

// 「その場でAIを呼ぶ」を使えるようにしたか。false のあいだは、公開サイトのサーバー（/api/tool-ai）が、どんな頼みにも unavailable と答える
// （人が承認した指示が公開の中身にあっても、AI を呼ばない。ダッシュボードの needs.ts の ready と一緒に true にする。PR #241 の ai-review の指摘）
export const TOOL_AI_LIVE = false;

// ---- AI を呼ぶときの費用（公開サイトのサーバー /api/tool-ai。docs/design-tool-limits.md の ③） ----
// モデルは Claude Haiku 5.5（運営者が決めた）。料金は 100万トークンあたり入力 0.10ドル・出力 0.50ドル（入力が10万トークンまで）
export const TOOL_AI_MODEL = "claude-haiku-5-5";
export const TOOL_AI_USD_PER_MTOK = { input: 0.1, output: 0.5 };
// 上限を見るときの換算。試算の 1ドル150円より高めにして、円安で上限を超えないようにする（PR #238 で直さずに残した指摘）
export const TOOL_AI_JPY_PER_USD = 170;
// 1文字が何トークンになるかの多めの見積もり（日本語の珍しい字は1文字で2〜3トークンになることがある）と、指示の決まり文句などの分
const TOKENS_PER_CHAR = 3;
const PROMPT_OVERHEAD_TOKENS = 400;
// 答えの長さの上限（文字）から、AI の出力の上限（トークン）を決める
export const answerMaxTokens = (outputMax: number) => outputMax * TOKENS_PER_CHAR;
// 答えを確かめる2回目の呼び出しの、出力の上限（OK か NG だけ）
export const CHECK_MAX_TOKENS = 8;

export const usdToJpy = (usd: number) => usd * TOOL_AI_JPY_PER_USD;
export const tokensCostJpy = (input: number, output: number) =>
  usdToJpy((input * TOOL_AI_USD_PER_MTOK.input + output * TOOL_AI_USD_PER_MTOK.output) / 1_000_000);

// 1回（答える＋確かめる）にかかりうる最大の額（円）。固定の指示を含めた、AI の会社に送る入力の全部と、出力の上限から出す（PR #238 の ai-review の指摘）
export function maxCostJpy(spec: ToolAiSpec, inputChars: number): number {
  const answerIn = (spec.instruction.length + inputChars) * TOKENS_PER_CHAR + PROMPT_OVERHEAD_TOKENS;
  const answerOut = answerMaxTokens(spec.outputMax);
  // 確かめる呼び出しには、見せる文（答え）だけを渡す
  const checkIn = spec.outputMax * TOKENS_PER_CHAR + PROMPT_OVERHEAD_TOKENS;
  return tokensCostJpy(answerIn + checkIn, answerOut + CHECK_MAX_TOKENS);
}

// 枠の中の window.labAi.ask(入力) の答え。ok でなければ reason だけ（unavailable: 使えない・limit: 今日はここまで・invalid: 入力が長い/空・failed: うまくいかなかった）
export type ToolAiAnswer = { ok: true; text: string } | { ok: false; reason: "unavailable" | "limit" | "invalid" | "failed" };
export const TOOL_AI_REASONS = ["unavailable", "limit", "invalid", "failed"] as const;
// 枠の中で答えを待つ長さ（ミリ秒）。ページの中継・サーバーの待ち（AI を2回呼ぶ）より長くする
export const TOOL_AI_WAIT_MS = 45_000;
// 公開サイトのサーバーが AI の会社の答えを待つ長さ（1回ごと。ミリ秒）
export const TOOL_AI_CALL_TIMEOUT_MS = 15_000;

// 公開サイトのサーバーの答えを、枠に渡す形にそろえる。成功は ok が true で text が文字列のときだけ、
// 失敗は ok が false で決まった理由のときだけ受け取り、ほかの形はすべて failed にする（PR #241 の ai-review の指摘）
export function toolAiAnswerOf(d: unknown): ToolAiAnswer {
  if (!d || typeof d !== "object") return { ok: false, reason: "failed" };
  const o = d as Record<string, unknown>;
  if (o.ok === true && typeof o.text === "string") return { ok: true, text: o.text };
  const reason = o.ok === false ? TOOL_AI_REASONS.find((r) => r === o.reason) : undefined;
  return { ok: false, reason: reason ?? "failed" };
}
