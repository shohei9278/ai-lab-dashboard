import { db, getSettings, monthSpendUsd } from "./db";
import { costUsd, getModel, hasKey } from "./models";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { callModel } from "./providers";

export class GuardError extends Error {}

// 製品ループ用のAI呼び出し。予算・緊急停止を確認し、費用を記録してJSONを返す
export async function callJson<T>(opts: {
  purpose: string;
  projectId?: number;
  system: string;
  user: string;
  validate: (v: unknown) => v is T;
  modelId?: string; // 指定しなければ、設定の「製品ループで使うAI」
}): Promise<T> {
  const s = getSettings();
  if (s.killSwitch) throw new GuardError("緊急停止中のため、AIを呼び出せません");
  if (monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) throw new GuardError("今月のAI予算の上限に達しています");
  const model = getModel(opts.modelId ?? s.loopModel);
  if (!hasKey(model.provider)) throw new GuardError(`${model.label} のAPIキーがありません`);

  const system = `${opts.system}\n\n出力はJSONのみ。前置きやコードブロックは付けないこと。`;
  // 形式が崩れたときは1回だけやり直す
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await callModel(model, { system, user: opts.user }, null);
    const cost = costUsd(model, r.inputTokens, r.outputTokens);
    const parsed = r.error ? null : parseJson(r.text);
    const ok = parsed !== null && opts.validate(parsed);
    db()
      .prepare(
        "INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(opts.projectId ?? null, opts.purpose, model.id, r.inputTokens, r.outputTokens, cost,
        r.error ?? (ok ? null : "JSONの形式が不正"));
    if (r.error) throw new Error(`AIの呼び出しに失敗しました: ${r.error.slice(0, 200)}`);
    if (ok) return parsed as T;
  }
  throw new Error("AIの出力を読み取れませんでした（2回失敗）");
}

// 長い出力（ページのHTMLなど）や、画像を見せる呼び出し用。Claude だけで、出力は文字のまま返す
// 製品ループのAIが Claude ならそれを、違えば Claude Opus を使う
export function claudeModelId(): string | null {
  const id = getSettings().loopModel;
  if (getModel(id).provider === "anthropic") return hasKey("anthropic") ? id : null;
  return hasKey("anthropic") ? "claude-opus-5-5" : null;
}

export type ClaudeContent = ({ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg"; data: string } })[];

export async function callClaude(opts: { purpose: string; projectId?: number; system: string; content: ClaudeContent; maxTokens: number; modelId?: string }): Promise<string> {
  const s = getSettings();
  if (s.killSwitch) throw new GuardError("緊急停止中のため、AIを呼び出せません");
  if (monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) throw new GuardError("今月のAI予算の上限に達しています");
  const id = opts.modelId ?? claudeModelId();
  if (!id || !hasKey("anthropic")) throw new GuardError("Claude のAPIキーがありません");
  const model = getModel(id);
  const log = (inTok: number, outTok: number, error: string | null) =>
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(opts.projectId ?? null, opts.purpose, model.id, inTok, outTok, costUsd(model, inTok, outTok), error);
  try {
    // 出力が長いので、途中で切れないよう流しながら受け取る
    const msg = await new Anthropic({ timeout: 15 * 60 * 1000, maxRetries: 1 }).messages.stream({
      model: model.id,
      max_tokens: opts.maxTokens,
      thinking: { type: "adaptive" },
      system: opts.system,
      messages: [{ role: "user", content: opts.content }],
    }).finalMessage();
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const error = msg.stop_reason === "refusal" ? "refusal" : msg.stop_reason === "max_tokens" ? "出力が長すぎて途中で切れました" : null;
    log(msg.usage.input_tokens, msg.usage.output_tokens, error);
    if (error) throw new Error(error);
    return text;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!/refusal|途中で切れました/.test(m)) log(0, 0, m.slice(0, 500));
    throw new Error(`AIの呼び出しに失敗しました: ${m.slice(0, 200)}`);
  }
}

// 長い出力（ツールのHTMLなど）を、決めたAIで最後まで受け取る。Claude と OpenAI に対応（文字のまま返す）
export async function callLong(opts: { modelId: string; purpose: string; projectId?: number; system: string; user: string; maxTokens: number }): Promise<string> {
  const model = getModel(opts.modelId);
  if (model.provider === "anthropic") {
    return callClaude({ purpose: opts.purpose, projectId: opts.projectId, system: opts.system, content: [{ type: "text", text: opts.user }], maxTokens: opts.maxTokens, modelId: model.id });
  }
  if (model.provider !== "openai") throw new Error(`${model.label} では長い出力に対応していません`);
  const s = getSettings();
  if (s.killSwitch) throw new GuardError("緊急停止中のため、AIを呼び出せません");
  if (monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) throw new GuardError("今月のAI予算の上限に達しています");
  if (!hasKey("openai")) throw new GuardError(`${model.label} のAPIキーがありません`);
  const log = (inTok: number, outTok: number, error: string | null) =>
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(opts.projectId ?? null, opts.purpose, model.id, inTok, outTok, costUsd(model, inTok, outTok), error);
  try {
    // 出力が長いので、待ち時間の上限を長めにとる
    const res = await new OpenAI({ timeout: 15 * 60 * 1000, maxRetries: 1 }).responses.create({
      model: model.id, instructions: opts.system, input: opts.user, max_output_tokens: opts.maxTokens,
    });
    const inTok = res.usage?.input_tokens ?? 0;
    const outTok = res.usage?.output_tokens ?? 0;
    const error = res.status === "incomplete" ? "出力が長すぎて途中で切れました" : null;
    log(inTok, outTok, error);
    if (error) throw new Error(error);
    return res.output_text;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (!/途中で切れました/.test(m)) log(0, 0, m.slice(0, 500));
    throw new Error(`AIの呼び出しに失敗しました: ${m.slice(0, 200)}`);
  }
}

function parseJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

export const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
