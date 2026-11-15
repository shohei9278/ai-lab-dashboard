import { NextResponse } from "next/server";
import { startCheckEval } from "@/lib/checkEval";

// 公開前チェックの評価を始める（裏で進め、結果は AIの成績 に出る）。運営者だけ（proxy.ts が来訪者の POST を断る）
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { modelId?: unknown };
  try {
    const id = startCheckEval(body.modelId);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
