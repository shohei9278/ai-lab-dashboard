import { NextResponse } from "next/server";
import { skipAiFix } from "@/lib/aiFix";
import { reviewTokenOk } from "@/lib/codeReview";

// 提案箱のルーティン（クラウドの Claude Code）が、頼まれた提案を「直さなくて良い」と判断したときの入口（docs/routine-proposal-fix.md）
// 合言葉（LAB_REVIEW_TOKEN）を Authorization: Bearer で送ったときだけ使える
// POST {"id": 提案箱の番号, "reason": "直さなくて良いと判断した理由"}: その提案を見送りにする（頼んでから3日以内・PR がまだないものだけ。aiFix.ts の skipAiFix）

export async function POST(req: Request) {
  if (!reviewTokenOk(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; reason?: unknown };
  const r = skipAiFix(body.id, body.reason);
  return NextResponse.json(r, { status: r.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
