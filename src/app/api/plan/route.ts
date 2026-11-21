import { NextResponse } from "next/server";
import { answerRequest, cancelTask, createPlan, editAnswer } from "@/lib/plan";
import { reviewPost } from "@/lib/postStats";
import { addProposal, promoteVoice } from "@/lib/voices";
import { reviveIdea } from "@/lib/loop";
import { startAiFix } from "@/lib/aiFix";

// 毎日の計画: 予定を取りやめる・今日の計画を作り直す・AIだけで出した投稿に印を付ける・提案箱の提案に答える（答えを直す）・提案を入れる・敗者復活の案で案件を作る・社員の声を提案箱に入れる・仕組みの改善をクラウドの Claude Code に直してもらう
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { propose?: { title?: unknown; how?: unknown }; reviveId?: unknown; promoteVoiceId?: unknown; cancelTaskId?: unknown; action?: unknown; aiFix?: { id?: unknown; note?: unknown }; review?: { table?: unknown; id?: unknown; verdict?: unknown; note?: unknown }; answer?: { id?: unknown; status?: unknown; note?: unknown; edit?: unknown } };
  try {
    const pr = body.propose;
    if (pr && typeof pr.title === "string" && pr.title.trim()) {
      const id = addProposal({ title: pr.title, how: typeof pr.how === "string" ? pr.how : "", target: "system", source: "human", scene: "あなた" });
      if (!id) return NextResponse.json({ error: "同じ題の提案が、すでに提案箱にあります" }, { status: 400 });
      return NextResponse.json({ id });
    }
    if (typeof body.reviveId === "number") return NextResponse.json({ projectId: await reviveIdea(body.reviveId) });
    if (typeof body.promoteVoiceId === "number") return NextResponse.json({ id: promoteVoice(body.promoteVoiceId) });
    const r = body.review;
    if (r && typeof r.id === "number" && (r.verdict === "ok" || r.verdict === "bad") && (r.table === "sns_posts" || r.table === "plan_tasks")) {
      reviewPost(r.table, r.id, r.verdict, typeof r.note === "string" ? r.note : "");
      return NextResponse.json({ ok: true });
    }
    const a = body.answer;
    if (a && typeof a.id === "number" && (a.status === "done" || a.status === "declined")) {
      (a.edit === true ? editAnswer : answerRequest)(a.id, a.status, typeof a.note === "string" ? a.note : "");
      return NextResponse.json({ ok: true });
    }
    const f = body.aiFix;
    if (f && typeof f.id === "number") return NextResponse.json(await startAiFix(f.id, typeof f.note === "string" ? f.note : ""));
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
