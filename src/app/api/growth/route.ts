import { NextResponse } from "next/server";
import { GuardError } from "@/lib/ai";
import { createGrowthPlan, toggleGrowthTask } from "@/lib/growth";

// 集客の作戦を作る・「今週やること」の済みを付ける
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (body.action === "create") {
      const f = Number(body.followers);
      return NextResponse.json({
        id: await createGrowthPlan({
          followers: body.followers === "" || body.followers === undefined || !Number.isFinite(f) ? null : Math.max(0, Math.round(f)),
          wish: typeof body.wish === "string" ? body.wish.trim().slice(0, 500) : "",
        }),
      });
    }
    if (body.action === "toggle") {
      toggleGrowthTask(Number(body.id), Number(body.index), body.done === true);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "操作が不正です" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof GuardError ? 403 : 400 });
  }
}
