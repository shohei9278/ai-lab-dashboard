import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug ?? "");
  const visitorId = String(body.visitorId ?? "").slice(0, 64);
  const lp = await getLp(slug);
  // 公開中の、今の版のLPだけを数える
  if (!lp || lp.status !== "published" || Number(body.version) !== lp.version || !visitorId) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const { error } = await supabase()
    .from("lp_views")
    .upsert(
      { slug, version: lp.version, visitor_id: visitorId, referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 300) : null },
      { onConflict: "slug,version,visitor_id,day", ignoreDuplicates: true },
    );
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
