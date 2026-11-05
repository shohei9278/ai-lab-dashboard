import { NextResponse } from "next/server";
import { deleteRef, queueRefs } from "@/lib/designRefs";
import { makeNeeds } from "@/lib/refNeeds";

// デザインの参考: URLを受け付ける・消す
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { urls?: unknown; url?: unknown; deleteId?: unknown; action?: unknown };
  if (body.action === "needs") {
    try {
      return NextResponse.json(await makeNeeds());
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
    }
  }
  if (typeof body.deleteId === "number") {
    deleteRef(body.deleteId);
    return NextResponse.json({ ok: true });
  }
  const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === "string") : typeof body.url === "string" ? [body.url] : [];
  if (!urls.length) return NextResponse.json({ error: "URLがありません" }, { status: 400 });
  return NextResponse.json({ added: queueRefs(urls.slice(0, 100)) });
}
