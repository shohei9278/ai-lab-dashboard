import { NextResponse } from "next/server";
import { GuardError } from "@/lib/ai";
import { addPost, deletePost, draftPosts, markPosted, setPostStats, updatePostText } from "@/lib/sns";
import { SNS_PLATFORMS } from "@/lib/growth";

// SNS投稿の下書き・編集・投稿済みの記録
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const text = typeof body.text === "string" ? body.text : "";
  try {
    switch (body.action) {
      case "draft": {
        const count = Math.min(5, Math.max(1, Number(body.count) || 3));
        const hint = typeof body.hint === "string" ? body.hint.trim().slice(0, 300) : undefined;
        return NextResponse.json({ ids: await draftPosts(Number(body.projectId), count, hint || undefined) });
      }
      case "add":
        if (!text.trim()) throw new Error("本文を書いてください");
        return NextResponse.json({
          id: addPost(Number(body.projectId), text.trim().slice(0, 1000), "human", null, typeof body.platform === "string" && body.platform in SNS_PLATFORMS ? body.platform : "x"),
        });
      case "update":
        updatePostText(Number(body.id), text);
        return NextResponse.json({ ok: true });
      case "posted":
        markPosted(Number(body.id), text || undefined);
        return NextResponse.json({ ok: true });
      case "stats":
        setPostStats(Number(body.id), {
          postUrl: typeof body.postUrl === "string" ? body.postUrl : undefined,
          impressions: body.impressions === "" || body.impressions === null ? null : body.impressions === undefined ? undefined : Number(body.impressions),
        });
        return NextResponse.json({ ok: true });
      case "delete":
        deletePost(Number(body.id));
        return NextResponse.json({ ok: true });
      default:
        return NextResponse.json({ error: "操作が不正です" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof GuardError ? 403 : 400 });
  }
}
