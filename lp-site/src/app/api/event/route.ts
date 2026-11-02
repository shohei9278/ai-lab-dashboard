import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";

// 動くツールを使った・シェアした、を記録する
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug ?? "");
  const kind = body.kind === "use" || body.kind === "share" ? body.kind : null;
  const visitorId = String(body.visitorId ?? "").slice(0, 64);
  const lp = await getLp(slug);
  // 公開中の、今の版のツールだけを数える
  if (!kind || !lp?.content.tool || lp.status !== "published" || Number(body.version) !== lp.version || !visitorId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { error } = await supabase()
    .from("tool_events")
    .upsert({ slug, version: lp.version, visitor_id: visitorId, kind }, { onConflict: "slug,version,visitor_id,kind,day", ignoreDuplicates: true });
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
