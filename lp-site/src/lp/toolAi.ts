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
