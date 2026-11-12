import { NextResponse } from "next/server";
import { startPromptTest } from "@/lib/promptCompare";

// プロンプトの比較を始める（裏で進め、結果は AIの成績 > プロンプトの比較 に出る）。運営者だけ（proxy.ts が来訪者の POST を断る）
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; factor?: unknown };
  try {
    const id = startPromptTest(Number(body.projectId), body.factor);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
