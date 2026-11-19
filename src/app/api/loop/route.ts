import { NextResponse, after } from "next/server";
import { GuardError } from "@/lib/ai";
import {
  holdProject, ideaRunning, logEvent, resumeProject, startDevUpload, markNeedsDone, addMetrics, autoFixPublish, changeIllustration, redesignPage, removePage, switchPageCandidate, reviewAutoPublished, decide, finalizeDecision, finishNotify, requestRevision, retestTool, retryDeepData, abandonStuck, resumeStuck, setSiteCategory, uploadDeepData, generateIdeas, getProject, judge, runDaily, setInitialChoice, simulatedDays, switchLpCandidate, syncAndJudge,
  type ApprovalAction,
} from "@/lib/loop";
import { signupEmails } from "@/lib/publish";
import { AIMS, isAim } from "@/lib/aims";
import { makePlayVideo } from "@/lib/playVideo";

// 長くかかる操作（アイデア会議・毎日の自動実行・遊ぶ様子の動画）は、受け付けたらすぐ返し、裏で進める
// 会議の前にXの検索も入るので、1回の通信で終わるまで待つと途中で切れ、画面に「通信に失敗しました」と出るため。進み具合はライブと経過で見る
// 返事のあとも終わるまで動かすよう、Next.js の after に渡す（本番は1台のサーバーで動き続けるが、実行の基盤に任せず保証する）
function background(projectId: number | null, label: string, job: Promise<unknown>) {
  const done = job.catch((e) => logEvent(projectId, "system", "background-error", `${label}に失敗しました: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
  try {
    after(() => done);
  } catch {
    // リクエストの外（テストなど）では after を使えないので、そのまま進める
    void done;
  }
}
function ideaFree() {
  const busy = ideaRunning();
  if (busy) throw new Error(`いま「${busy}」が動いています。終わってからもう一度押してください`);
}

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
        const deep = body.deep === true;
        const aim = isAim(body.aim) ? body.aim : undefined;
        if (deep && aim && AIMS[aim].kind !== "tool") throw new Error("じっくり案件では、需要を確かめる（事前登録LP）は選べません");
        ideaFree();
        background(null, "アイデア出し", generateIdeas(theme, deep ? Math.min(count, 2) : count, deep, aim));
        return NextResponse.json({ accepted: true });
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
        // 途中で止まった案件の作り直し・やり直し（止まる前の操作からやり直す。resumeStuck）
        await resumeStuck(requireProject(body).id);
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
      case "needs-done":
        background(Number(body.projectId), "作り始めること", markNeedsDone(requireProject(body).id));
        return NextResponse.json({ accepted: true });
      case "dev-upload": {
        // 決まりに合わないHTMLは、すぐ理由を返す。入れたら、チェック・紹介ページづくりは裏で進める（数分かかる）
        const html = typeof body.html === "string" ? body.html : "";
        const approvalId = Number(body.approvalId);
        const job = startDevUpload(approvalId, html);
        background(null, "Claude Code で作ったツールの取り込み", job);
        return NextResponse.json({ accepted: true });
      }
      case "play-video": {
        const p = requireProject(body);
        if (p.kind !== "tool") throw new Error("動くツールの案件だけ、遊ぶ様子の動画を作れます");
        background(p.id, "遊ぶ様子の動画", makePlayVideo(p.id));
        return NextResponse.json({ accepted: true });
      }
      case "test-tool":
        return NextResponse.json(await retestTool(requireProject(body).id));
      case "site-category":
        await setSiteCategory(requireProject(body).id, typeof body.category === "string" && body.category ? body.category : null);
        return NextResponse.json({ ok: true });
      case "abandon":
        abandonStuck(requireProject(body).id, typeof body.reason === "string" ? body.reason : "");
        return NextResponse.json({ ok: true });
      case "deep-retry":
        await retryDeepData(requireProject(body).id);
        return NextResponse.json({ ok: true });
      case "deep-upload": {
        if (typeof body.text !== "string" || body.text.length > 1_500_000) throw new Error("データは1,500,000文字までの文字で入れてください");
        return NextResponse.json({ rows: uploadDeepData(Number(body.approvalId), body.text) });
      }
      case "use-page":
        await switchPageCandidate(requireProject(body).id, Number(body.candidateId));
        return NextResponse.json({ ok: true });
      case "use-candidate":
        await switchLpCandidate(Number(body.candidateId));
        return NextResponse.json({ ok: true });
      case "sync":
        return NextResponse.json(await syncAndJudge());
      case "daily":
        ideaFree();
        background(null, "毎日の自動実行", runDaily({ force: true }));
        return NextResponse.json({ accepted: true });
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
