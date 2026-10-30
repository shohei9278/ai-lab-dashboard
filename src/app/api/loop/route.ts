import { NextResponse } from "next/server";
import { GuardError } from "@/lib/ai";
import {
  addMetrics, decide, finalizeDecision, generateIdeas, getProject, judge, prepareLp, runDaily, setInitialChoice, simulatedDays,
  type ApprovalAction,
} from "@/lib/loop";
import { clearDemo, seedDemo } from "@/lib/demo";

// 製品ループの操作をまとめて受け付ける
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  try {
    switch (body.action) {
      case "ideas": {
        const theme = typeof body.theme === "string" ? body.theme.slice(0, 200) : "";
        const count = Math.min(5, Math.max(1, Number(body.count) || 3));
        return NextResponse.json({ ids: await generateIdeas(theme, count) });
      }
      case "decide": {
        const action = body.decision as ApprovalAction;
        if (!["approve", "reject", "revise"].includes(action)) throw new Error("操作が不正です");
        await decide(Number(body.approvalId), action, typeof body.comment === "string" ? body.comment.slice(0, 500) : undefined);
        return NextResponse.json({ ok: true });
      }
      case "initial":
        setInitialChoice(Number(body.approvalId), String(body.choice));
        return NextResponse.json({ ok: true });
      case "final":
        await finalizeDecision(Number(body.approvalId), String(body.choice), typeof body.comment === "string" ? body.comment.slice(0, 500) : undefined);
        return NextResponse.json({ ok: true });
      case "generate-lp":
        await prepareLp(requireProject(body).id);
        return NextResponse.json({ ok: true });
      case "daily":
        return NextResponse.json(await runDaily({ force: true }));
      case "judge":
        await judge(requireProject(body).id);
        return NextResponse.json({ ok: true });
      case "simulate": {
        const p = requireProject(body);
        const judged = await addMetrics(p.id, simulatedDays(p, Math.min(7, Math.max(1, Number(body.days) || 3))));
        return NextResponse.json({ ok: true, judged });
      }
      case "metrics": {
        const p = requireProject(body);
        const visits = Math.max(0, Math.round(Number(body.visits)));
        const signups = Math.max(0, Math.round(Number(body.signups)));
        const adSpendJpy = Math.max(0, Math.round(Number(body.adSpendJpy) || 0));
        if (!Number.isFinite(visits) || !Number.isFinite(signups) || signups > visits) throw new Error("訪問数と登録数を確認してください");
        const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : new Date().toISOString().slice(0, 10);
        const judged = await addMetrics(p.id, [{ day, visits, signups, adSpendJpy, source: "manual" }]);
        return NextResponse.json({ ok: true, judged });
      }
      case "seed-demo":
        seedDemo();
        return NextResponse.json({ ok: true });
      case "clear-demo":
        clearDemo();
        return NextResponse.json({ ok: true });
      default:
        throw new Error("不明な操作です");
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: e instanceof GuardError ? 403 : 400 });
  }
}

function requireProject(body: Record<string, unknown>) {
  const p = getProject(Number(body.projectId));
  if (!p) throw new Error("案件が見つかりません");
  return p;
}
