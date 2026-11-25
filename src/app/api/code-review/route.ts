import { NextResponse } from "next/server";
import { addReviewFindings, reviewContext, reviewTokenOk } from "@/lib/codeReview";

// コードの見直しのルーティン（クラウドの Claude Code）専用の入口（src/lib/codeReview.ts・docs/routine-code-review.md）
// 合言葉（LAB_REVIEW_TOKEN）を Authorization: Bearer で送ったときだけ使える
// GET: いまの「仕組みの改善」（返事待ちと、60日のあいだに返事をしたもの）。同じことを出さないために読む
// POST {"items": [{"title": "...", "how": "...", "why": "..."}]}: 見つけたことを提案箱に入れる（1回の見直しで8件まで。2日のあいだで数える）

const noStore = { headers: { "Cache-Control": "no-store" } };

export async function GET(req: Request) {
  if (!reviewTokenOk(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  return NextResponse.json({ proposals: reviewContext() }, noStore);
}

export async function POST(req: Request) {
  if (!reviewTokenOk(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { items?: unknown };
  try {
    return NextResponse.json(addReviewFindings(body.items), noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400, ...noStore });
  }
}
