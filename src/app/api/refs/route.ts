import { NextResponse } from "next/server";
import { deleteRef, queueRefs } from "@/lib/designRefs";

// デザインの参考: URLを受け付ける・消す
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { urls?: unknown; url?: unknown; deleteId?: unknown };
  if (typeof body.deleteId === "number") {
    deleteRef(body.deleteId);
    return NextResponse.json({ ok: true });
  }
  const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string") : typeof body.url === "string" ? [body.url] : [];
  if (!urls.length) return NextResponse.json({ error: "URLがありません" }, { status: 400 });
  return NextResponse.json({ added: queueRefs(urls.slice(0, 100)) });
}
