import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getToolAiSpec, supabase } from "@/lib/supabase";
import { answerToolAi, ModelCallError, type ModelCall, type ModelResult } from "@/lib/toolAiServer";
import { TOOL_AI_CALL_TIMEOUT_MS, TOOL_AI_MODEL } from "@/lp/toolAi";

// その場で AI を呼ぶツールの頼み（window.labAi.ask）に答える（toolAiServer.ts。docs/design-tool-limits.md の ③）
// AI のキーは、公開サイトの変数 TOOL_AI_ANTHROPIC_API_KEY にだけ置く（ダッシュボードとは別のキー。運営者が Console で使える額の上限を付ける）
// キーがない・Supabase の関数がないときは、使えない（unavailable / limit）と答える
export const maxDuration = 60;

let client: Anthropic | null = null;
function anthropic(): Anthropic | null {
  const apiKey = process.env.TOOL_AI_ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  // 自動でやり直さない（やり直すと、取っておいた1回分の額を超えてお金がかかることがある。PR #238 の ai-review の指摘）
  client ??= new Anthropic({ apiKey, maxRetries: 0, timeout: TOOL_AI_CALL_TIMEOUT_MS });
  return client;
}

async function callModel(c: ModelCall): Promise<ModelResult> {
  const ai = anthropic();
  if (!ai) throw new ModelCallError("not-billed");
  try {
    const res = await ai.messages.create({
      model: TOOL_AI_MODEL,
      max_tokens: c.maxTokens,
      // 考える分も出力として数えられるので、考えさせない（Claude Haiku 5.5 は、effort が high 以下なら考えないにできる）
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: c.system,
      messages: [{ role: "user", content: c.user }],
    });
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { text, inputTokens: res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0), outputTokens: res.usage.output_tokens, refused: res.stop_reason === "refusal" };
  } catch (e) {
    // 4xx の答えが返ってきたときは、AI の会社では処理されていない。時間切れ・つながらない・5xx は、かかったか分からない
    if (e instanceof Anthropic.APIError && typeof e.status === "number" && e.status >= 400 && e.status < 500) throw new ModelCallError("not-billed");
    throw new ModelCallError("unknown");
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const answer = await answerToolAi(body, {
    spec: (slug, version) => getToolAiSpec(slug, version).catch(() => null),
    reserve: async (r) => {
      if (!anthropic()) return null;
      const { data, error } = await supabase().rpc("reserve_tool_ai", { p_slug: r.slug, p_version: r.version, p_visitor: r.visitorId, p_amount: r.amountJpy });
      if (error) { console.error("tool-ai: reserve", error.code); return null; }
      const n = typeof data === "string" ? Number(data) : data;
      return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : null;
    },
    settle: async (id, spentJpy) => {
      const { error } = await supabase().rpc("settle_tool_ai", { p_id: id, p_spent: spentJpy });
      if (error) console.error("tool-ai: settle", error.code);
    },
    call: callModel,
    // 訪問者の入力と AI の答えはログに出さない（種類だけ）
    log: (msg) => console.error(msg),
  });
  return NextResponse.json(answer, { headers: { "Cache-Control": "no-store" } });
}
