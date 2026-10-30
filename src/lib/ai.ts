import { db, getSettings, monthSpendUsd } from "./db";
import { costUsd, getModel, hasKey } from "./models";
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
