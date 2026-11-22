import crypto from "node:crypto";
import OpenAI from "openai";
import { gemini } from "./gemini";
import { db, getSettings, monthSpendUsd, type ProjectRow } from "./db";
import { GuardError } from "./ai";
import { hasKey } from "./models";
import { publishingConfigured, uploadImage } from "./publish";
import { THEMES, type IllustrationStyle, type Lp } from "../../lp-site/src/lp/content";

// LPの見出しの横に置くイラストを、画像生成AIで描く
// - 何を描くか（主役の物）と画風は、LPを書いたAIが案件ごとに決める（illustrationPrompt・illustrationStyle）
//   画風を1つに固定すると、写真に近い遊びや和の題材などで、ページやツールの世界観とずれるため
// - ここで、崩れやすいもの（手・顔・人物・画面・文字）を描かない決まりと、小さなカードでも分かる構図、テーマの色を足す
// - 保存先は Supabase の公開用の保存領域（公開サイトとダッシュボードの両方から見える）
// - 費用は1枚あたりの目安で記録する（画像の料金は大きさと品質で変わるため）

const MODELS = {
  // high・1536x1024 の目安（外部の料金表で $0.165。予算を少なく見積もらないよう切り上げた）
  "gpt-image-2": { provider: "openai" as const, costUsd: 0.17 },
  "gemini-3.1-flash-image": { provider: "google" as const, costUsd: 0.07 },
};
type ImageModel = keyof typeof MODELS;

function pickModel(): ImageModel | null {
  if (hasKey("openai")) return "gpt-image-2";
  if (hasKey("google")) return "gemini-3.1-flash-image";
  return null;
}

// 画風ごとの描き方（ILLUSTRATION_STYLES と同じ名前）
const STYLE_PROMPTS: Record<IllustrationStyle, string> = {
  photo: "Style: high-quality photographic still life, natural soft light, shallow depth of field, realistic materials and textures.",
  // やわらかい立体は、写真に近く描かれやすかった（PR #136 の試し描き）。作った立体のイラストだと分かるよう、形と質感をはっきり崩させる
  soft3d: "Style: stylized 3D illustration that looks like a handmade clay or soft vinyl toy: simplified, chunky, rounded shapes with exaggerated proportions, smooth matte pastel materials, soft studio lighting with gentle shadows, on a plain softly colored backdrop. It must clearly look like a 3D illustration, not a photograph: no realistic textures, no fine photographic detail, no depth-of-field blur.",
  flat: "Style: polished flat vector illustration, clean simple shapes, soft gradients, consistent line weight.",
  papercut: "Style: layered paper-cut craft, real paper textures, soft drop shadows between layers.",
  watercolor: "Style: refined watercolor painting, soft washes and visible paper grain, delicate edges.",
};

export function buildPrompt(lp: Lp, title: string): string {
  const theme = THEMES[lp.design?.theme ?? "trust"];
  const scene = lp.illustrationPrompt || `A single object that symbolizes a small web service called "${title}".`;
  return [
    scene,
    STYLE_PROMPTS[lp.illustrationStyle ?? "flat"],
    // 指示に物を2つ以上書くと、そのまま並べて描かれた（PR #136 の試し描き）。最初に書かれた物だけを描かせる
    // 「いちばん大事な物」と書くと、開いた冊子がノートPCに置き換わった（soft3d の試し描き）。選ばせず、別の物に変えさせない
    `Composition: exactly one main object, large and centered with some breathing room, on a simple uncluttered background. The main object is the first object named in the description; leave out the other objects it mentions (at most one tiny supporting detail), and do not swap it for a different object. It must still read clearly when shown as a small thumbnail.`,
    `Color: harmonize with ${theme.accent[0]} and ${theme.soft[0]}.`,
    `Strictly no hands, no people, no faces, no body parts, no phones, no laptops, no computers, no screens or monitors of any kind, no user interface, no text, no letters, no numbers, no logos, no watermarks, no brand names.`,
    `Landscape composition (3:2).`,
  ].join(" ");
}

async function draw(model: ImageModel, prompt: string): Promise<{ bytes: Buffer; type: string }> {
  if (MODELS[model].provider === "openai") {
    // シェア画像の部品でも読めるよう JPEG にする
    const r = await new OpenAI().images.generate({ model, prompt, size: "1536x1024", quality: "high", output_format: "jpeg", output_compression: 85, n: 1 });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error("画像が返ってきませんでした");
    return { bytes: Buffer.from(b64, "base64"), type: "image/jpeg" };
  }
  const r = await gemini().models.generateContent({
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
