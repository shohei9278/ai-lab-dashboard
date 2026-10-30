import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ModelDef } from "./models";
import type { Dataset, Item } from "./tasks";

export type CallResult = {
  text: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error?: string;
};

export async function callModel(
  model: ModelDef,
  prompt: { system: string; user: string },
  mock: { ds: Dataset; item: Item; rep: number } | null,
): Promise<CallResult> {
  if (mock) return mockCall(model, prompt, mock.ds, mock.item, mock.rep);
  for (let attempt = 0; ; attempt++) {
    const started = Date.now();
    try {
      const r = await realCall(model, prompt);
      return { ...r, latencyMs: Date.now() - started };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (attempt < RETRY_WAIT_MS.length && isRetryable(e, msg)) {
        await new Promise((r) => setTimeout(r, RETRY_WAIT_MS[attempt]));
        continue;
      }
      return { text: "", inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, error: msg.slice(0, 500) };
    }
  }
}

// 1分あたりの回数制限などは待てば通るので再送する。上限が0（無料枠で使えないモデル）は待っても無駄なので再送しない
const RETRY_WAIT_MS = [5_000, 15_000, 30_000];

function isRetryable(e: unknown, msg: string): boolean {
  const status = (e as { status?: number }).status;
  if (status === 429) return !/limit: 0\b/.test(msg);
  return status === 408 || status === 529 || (status !== undefined && status >= 500);
}

async function realCall(model: ModelDef, prompt: { system: string; user: string }) {
  if (model.provider === "anthropic") {
    // 比較を公平にするため、拒否時に別モデルへ切り替える fallbacks は使わない（拒否はそのまま記録する）
    const client = new Anthropic();
    const res = await client.messages.create({
      model: model.id,
      max_tokens: 16000,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
      output_config: { effort: "medium" },
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return {
      text,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      error: res.stop_reason === "refusal" ? "refusal" : undefined,
    };
  }

  if (model.provider === "openai") {
    const client = new OpenAI();
    const res = await client.responses.create({
      model: model.id,
      instructions: prompt.system,
      input: prompt.user,
    });
    return {
      text: res.output_text,
      inputTokens: res.usage?.input_tokens ?? 0,
      outputTokens: res.usage?.output_tokens ?? 0,
    };
  }

  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await client.models.generateContent({
    model: model.id,
    contents: prompt.user,
    config: { systemInstruction: prompt.system },
  });
  const u = res.usageMetadata;
  return {
    text: res.text ?? "",
    inputTokens: u?.promptTokenCount ?? 0,
    // 思考トークンも出力として課金される
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
  };
}

// ---- ダミー実行 ----
// 実際の API を呼ばずに、モデルごとに決めた「正確さ」と「ブレやすさ」で回答を作る。
// 画面や集計の動作確認用。結果はモデルの実力とは無関係。

const MOCK_PROFILE: Record<string, { acc: number; flip: number; formatErr: number; thinkTokens: number }> = {
  "claude-opus-5-5": { acc: 0.93, flip: 0.03, formatErr: 0.0, thinkTokens: 400 },
  "claude-haiku-5-5": { acc: 0.82, flip: 0.08, formatErr: 0.02, thinkTokens: 150 },
  "gpt-5.6-sol": { acc: 0.92, flip: 0.04, formatErr: 0.01, thinkTokens: 500 },
  "gpt-5.6-luna": { acc: 0.8, flip: 0.1, formatErr: 0.03, thinkTokens: 200 },
  "gemini-3.1-pro-preview": { acc: 0.9, flip: 0.05, formatErr: 0.01, thinkTokens: 450 },
  "gemini-3.5-flash-lite": { acc: 0.76, flip: 0.12, formatErr: 0.04, thinkTokens: 100 },
};

function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

async function mockCall(
  model: ModelDef,
  prompt: { system: string; user: string },
  ds: Dataset,
  item: Item,
  rep: number,
): Promise<CallResult> {
  const p = MOCK_PROFILE[model.id] ?? { acc: 0.8, flip: 0.08, formatErr: 0.02, thinkTokens: 200 };
  const key = `${model.id}|${item.id}`;
  // 問題ごとの難しさ（全モデル共通）で正答率を少し上下させる
  const difficulty = rand(`difficulty|${item.id}`) * 0.2 - 0.1;
  const baseCorrect = rand(`${key}|base`) < p.acc - difficulty;
  const flipped = rand(`${key}|${rep}|flip`) < p.flip;
  const correct = flipped ? !baseCorrect : baseCorrect;

  let text: string;
  if (ds.task === "classification") {
    const wrong = ds.labels!.filter((l) => l !== item.answer);
    const pick = wrong[Math.floor(rand(`${key}|${flipped ? rep : "w"}`) * wrong.length)];
    text = JSON.stringify({ label: correct ? item.answer : pick });
  } else {
    const ans = { ...(item.answer as Record<string, string | number>) };
    if (!correct) {
      const f = ds.fields![Math.floor(rand(`${key}|${flipped ? rep : "f"}`) * ds.fields!.length)];
      ans[f] = typeof ans[f] === "number" ? Math.round((ans[f] as number) * 1.1) : `${ans[f]}?`;
    }
    text = JSON.stringify(ans);
  }
  if (rand(`${key}|${rep}|fmt`) < p.formatErr) text = `回答は以下の通りです。\n${text.replace(/[{}]/g, "")}`;

  const inputTokens = Math.round((prompt.system.length + prompt.user.length) * 1.1);
  const outputTokens = text.length + Math.round(p.thinkTokens * (0.6 + rand(`${key}|${rep}|tok`) * 0.8));
  const latencyMs = Math.round(400 + p.thinkTokens * 4 * (0.5 + rand(`${key}|${rep}|lat`)));
  await new Promise((r) => setTimeout(r, 5));
  return { text, inputTokens, outputTokens, latencyMs };
}
