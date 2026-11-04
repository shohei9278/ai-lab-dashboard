import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";

// ページの中での動き（GA に送るのと同じイベント）を記録する。公開中の、今の版だけを数える
const NAMES = new Set(["cta_click", "form_start", "section_view", "scroll_depth", "sign_up", "sign_up_error", "tool_use", "share"]);

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug ?? "");
  const name = String(body.name ?? "");
  const visitorId = String(body.visitorId ?? "").slice(0, 64);
  const detail = String(body.detail ?? "").replace(/[^\w.-]/g, "").slice(0, 30);
  if (!NAMES.has(name) || !visitorId || !slug) return NextResponse.json({ ok: false }, { status: 400 });
  const lp = await getLp(slug);
  if (!lp || lp.status !== "published" || Number(body.version) !== lp.version) return NextResponse.json({ ok: false }, { status: 400 });
  const { error } = await supabase()
    .from("lp_events")
    .upsert({ slug, version: lp.version, visitor_id: visitorId, name, detail }, { onConflict: "slug,version,visitor_id,name,detail,day", ignoreDuplicates: true });
  // 表をまだ作っていないときは、黙って捨てる（GA には送られている）
  if (error) return NextResponse.json({ ok: false }, { status: /lp_events/.test(error.message) ? 200 : 500 });
  return NextResponse.json({ ok: true });
}
