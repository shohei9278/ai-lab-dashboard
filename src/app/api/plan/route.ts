import { NextResponse } from "next/server";
import { cancelTask, createPlan } from "@/lib/plan";

// 毎日の計画: 予定を取りやめる・今日の計画を作り直す
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { cancelTaskId?: unknown; action?: unknown };
  try {
    if (typeof body.cancelTaskId === "number") {
      cancelTask(body.cancelTaskId);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "replan") return NextResponse.json({ id: await createPlan({ force: true }) });
    return NextResponse.json({ error: "操作が分かりません" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
