import { NextResponse } from "next/server";
import { answerRequest, cancelTask, createPlan } from "@/lib/plan";
import { reviewPost } from "@/lib/postStats";

// 毎日の計画: 予定を取りやめる・今日の計画を作り直す・AIだけで出した投稿に印を付ける・AIからのお願いに答える
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { cancelTaskId?: unknown; action?: unknown; review?: { table?: unknown; id?: unknown; verdict?: unknown; note?: unknown }; answer?: { id?: unknown; status?: unknown; note?: unknown } };
  try {
    const r = body.review;
    if (r && typeof r.id === "number" && (r.verdict === "ok" || r.verdict === "bad") && (r.table === "sns_posts" || r.table === "plan_tasks")) {
      reviewPost(r.table, r.id, r.verdict, typeof r.note === "string" ? r.note : "");
      return NextResponse.json({ ok: true });
    }
    const a = body.answer;
    if (a && typeof a.id === "number" && (a.status === "done" || a.status === "declined")) {
      answerRequest(a.id, a.status, typeof a.note === "string" ? a.note : "");
      return NextResponse.json({ ok: true });
    }
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
