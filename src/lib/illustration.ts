import crypto from "node:crypto";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { db, getSettings, monthSpendUsd, type ProjectRow } from "./db";
import { GuardError } from "./ai";
import { hasKey } from "./models";
import { publishingConfigured, uploadImage } from "./publish";
import { THEMES, type Lp } from "../../lp-site/src/lp/content";

// LPの見出しの横に置くイラストを、画像生成AIで描く
// - 指示はLPを書いたAIが考え（illustrationPrompt）、ここで「文字・ロゴ・実在の人物を描かない」などの決まりとテーマの色を足す
// - 保存先は Supabase の公開用の保存領域（公開サイトとダッシュボードの両方から見える）
// - 費用は1枚あたりの目安で記録する（画像の料金は大きさと品質で変わるため）

const MODELS = {
  "gpt-image-2": { provider: "openai" as const, costUsd: 0.08 },
  "gemini-3.1-flash-image": { provider: "google" as const, costUsd: 0.07 },
};
type ImageModel = keyof typeof MODELS;

function pickModel(): ImageModel | null {
  if (hasKey("openai")) return "gpt-image-2";
  if (hasKey("google")) return "gemini-3.1-flash-image";
  return null;
}

function buildPrompt(lp: Lp, title: string): string {
  const theme = THEMES[lp.design?.theme ?? "trust"];
  const scene = lp.illustrationPrompt || `An illustration that represents a small web service called "${title}" being used happily.`;
  return [
    scene,
    `Style: modern flat vector illustration, simple shapes, soft gradients, generous empty space, friendly and calm.`,
    `Color palette: mainly ${theme.accent[0]} and ${theme.soft[0]} with white and a few neutral grays.`,
    `Strictly no text, no letters, no numbers, no logos, no watermarks, no brand names, no real people or celebrities, no detailed realistic faces.`,
    `Landscape composition (3:2).`,
  ].join(" ");
}

async function draw(model: ImageModel, prompt: string): Promise<{ bytes: Buffer; type: string }> {
  if (MODELS[model].provider === "openai") {
    // シェア画像の部品でも読めるよう JPEG にする
    const r = await new OpenAI().images.generate({ model, prompt, size: "1536x1024", quality: "medium", output_format: "jpeg", output_compression: 85, n: 1 });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error("画像が返ってきませんでした");
    return { bytes: Buffer.from(b64, "base64"), type: "image/jpeg" };
  }
  const r = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.generateContent({
    model,
    contents: prompt,
    config: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "3:2" } },
  });
  const part = r.candidates?.[0]?.content?.parts?.find((x) => x.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("画像が返ってきませんでした");
  return { bytes: Buffer.from(part.inlineData.data, "base64"), type: part.inlineData.mimeType ?? "image/png" };
}

// イラストを描いて保存し、LPに付けた形で返す。描けないとき（設定オフ・キーや保存先がない）は、そのまま返す
export async function withIllustration(p: ProjectRow, lp: Lp, version: number, opts: { force?: boolean } = {}): Promise<{ lp: Lp; note: string | null }> {
  const s = getSettings();
  if (!lp.design) return { lp, note: null };
  if (lp.design.illustration && !opts.force) return { lp, note: null };
  if (!s.illustrations && !opts.force) return { lp, note: null };
  const model = pickModel();
  if (!model) return { lp, note: "画像を描けるAIのキーがないため、イラストなし" };
  if (!publishingConfigured()) return { lp, note: "Supabase の設定がないため、イラストなし" };
  if (s.killSwitch) throw new GuardError("緊急停止中のため、AIを呼び出せません");
  if (monthSpendUsd() * s.usdJpy >= s.monthlyBudgetJpy) throw new GuardError("今月のAI予算の上限に達しています");

  const prompt = buildPrompt(lp, p.title);
  let error: string | null = null;
  try {
    const img = await draw(model, prompt);
    const ext = img.type.includes("webp") ? "webp" : img.type.includes("jpeg") ? "jpg" : "png";
    const url = await uploadImage(`p${p.id}/v${version}-${crypto.randomBytes(3).toString("hex")}.${ext}`, img.bytes, img.type);
    return { lp: { ...lp, design: { ...lp.design, illustration: { url, alt: `${p.title}のイメージイラスト` } } }, note: null };
  } catch (e) {
    error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    return { lp, note: `イラストを描けませんでした: ${error}` };
  } finally {
    // 失敗しても請求されることがあるので、目安の費用で記録する
    db().prepare("INSERT INTO ai_calls (project_id, purpose, model_id, input_tokens, output_tokens, cost_usd, error) VALUES (?, ?, ?, 0, 0, ?, ?)")
      .run(p.id, "イラスト作成", model, error ? 0 : MODELS[model].costUsd, error);
  }
}
