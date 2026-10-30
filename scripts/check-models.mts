// models.ts のモデルIDが各社で実在するかを確認する（一覧取得のみで料金はかからない）
// 使い方: npx tsx --env-file=.env.local scripts/check-models.mts
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { MODELS } from "../src/lib/models";

async function list(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = { anthropic: [], openai: [], google: [] };
  try {
    for await (const m of new Anthropic().models.list()) out.anthropic.push(m.id);
  } catch (e) {
    console.error("anthropic:", (e as Error).message);
  }
  try {
    for await (const m of new OpenAI().models.list()) out.openai.push(m.id);
  } catch (e) {
    console.error("openai:", (e as Error).message);
  }
  try {
    const pager = await new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }).models.list();
    for await (const m of pager) if (m.name) out.google.push(m.name.replace(/^models\//, ""));
  } catch (e) {
    console.error("google:", (e as Error).message);
  }
  return out;
}

const available = await list();
for (const m of MODELS) {
  console.log(`${available[m.provider].includes(m.id) ? "OK " : "NG "} ${m.provider.padEnd(9)} ${m.id}`);
}
const filter = process.argv[2];
if (filter) {
  for (const [p, ids] of Object.entries(available)) {
    console.log(`\n[${p}] ${ids.filter((id) => id.includes(filter)).sort().join(", ")}`);
  }
}
