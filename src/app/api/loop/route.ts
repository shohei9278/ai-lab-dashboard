import { NextResponse } from "next/server";
import { GuardError } from "@/lib/ai";
import {
  holdProject, resumeProject, addMetrics, autoFixPublish, changeIllustration, redesignPage, removePage, switchPageCandidate, reviewAutoPublished, decide, finalizeDecision, finishNotify, requestRevision, retestTool, generateIdeas, getProject, judge, prepareLp, runDaily, setInitialChoice, simulatedDays, switchLpCandidate, syncAndJudge,
  type ApprovalAction,
} from "@/lib/loop";
import { signupEmails } from "@/lib/publish";

// 製品ループの操作をまとめて受け付ける
export async function POST(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  try {
    switch (body.action) {
      case "hold":
        holdProject(Number(body.projectId), String(body.reason ?? ""), String(body.until ?? ""), body.seasonal === true);
        return NextResponse.json({ ok: true });
      case "resume":
        resumeProject(Number(body.projectId));
        return NextResponse.json({ ok: true });
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
      case "generate-lp": {
        // 途中で止まった案件の作り直し。自動モードの案件は、最初に作るときと同じ扱いにする（全自動ならチェックを通れば公開）
        const p = requireProject(body);
        await prepareLp(p.id, undefined, { auto: p.mode === "auto" && !p.public_slug });
        return NextResponse.json({ ok: true });
      }
      case "revise": {
        const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 1000) : "";
        if (!instruction) throw new Error("修正の内容を書いてください");
        await requestRevision(requireProject(body).id, instruction, body.keepCore !== false);
        return NextResponse.json({ ok: true });
      }
      case "notify-emails": {
        const p = requireProject(body);
        if (!p.public_slug || p.notify_status !== "pending") throw new Error("連絡が必要な案件ではありません");
        return NextResponse.json({ emails: await signupEmails(p.public_slug) });
      }
      case "notify-done":
        return NextResponse.json({ deleted: await finishNotify(requireProject(body).id) });
      case "illustration":
        await changeIllustration(requireProject(body).id, body.mode === "remove" ? "remove" : "redraw");
        return NextResponse.json({ ok: true });
      case "auto-fix":
        await autoFixPublish(Number(body.approvalId), typeof body.instruction === "string" ? body.instruction.slice(0, 2000) : undefined);
        return NextResponse.json({ ok: true });
      case "human-review":
        await reviewAutoPublished(requireProject(body).id, body.verdict === "bad" ? "bad" : "ok", typeof body.note === "string" ? body.note.trim().slice(0, 500) : "", body.stop === true);
        return NextResponse.json({ ok: true });
      case "page":
        if (body.mode === "remove") await removePage(requireProject(body).id);
        else await redesignPage(requireProject(body).id);
        return NextResponse.json({ ok: true });
      case "test-tool":
        return NextResponse.json(await retestTool(requireProject(body).id));
      case "use-page":
        await switchPageCandidate(requireProject(body).id, Number(body.candidateId));
        return NextResponse.json({ ok: true });
      case "use-candidate":
        await switchLpCandidate(Number(body.candidateId));
        return NextResponse.json({ ok: true });
      case "sync":
        return NextResponse.json(await syncAndJudge());
      case "daily":
        return NextResponse.json(await runDaily({ force: true }));
      case "judge":
        await judge(requireProject(body).id);
        return NextResponse.json({ ok: true });
      case "simulate": {
        const p = requireProject(body);
        if (!p.demo) throw new Error("シミュレーションはデモ案件でだけ使えます（本物の案件の判断に架空の数字が混ざらないように）");
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
