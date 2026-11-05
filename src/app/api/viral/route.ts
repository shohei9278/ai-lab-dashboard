import { NextResponse } from "next/server";
import { deleteViral, queueViral, searchAll } from "@/lib/viralPosts";
import { deleteWant } from "@/lib/userWants";

// 話題の投稿: URLを受け付ける・消す・今すぐ検索する
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { urls?: unknown; deleteId?: unknown; deleteWantId?: unknown; action?: unknown };
  try {
    if (body.action === "search") return NextResponse.json(await searchAll());
    if (typeof body.deleteWantId === "number") {
      deleteWant(body.deleteWantId);
      return NextResponse.json({ ok: true });
    }
    if (typeof body.deleteId === "number") {
      deleteViral(body.deleteId);
      return NextResponse.json({ ok: true });
    }
    const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string") : [];
    if (!urls.length) return NextResponse.json({ error: "URLがありません" }, { status: 400 });
    return NextResponse.json({ added: queueViral(urls.slice(0, 50)) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
