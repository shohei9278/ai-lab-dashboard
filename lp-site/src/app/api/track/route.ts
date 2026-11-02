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
  const row = { slug, version: lp.version, visitor_id: visitorId, referrer: typeof body.referrer === "string" ? body.referrer.slice(0, 300) : null };
  const source = typeof body.source === "string" && /^[a-z0-9]{4,12}$/.test(body.source) ? body.source : null;
  const save = (r: Record<string, unknown>) =>
    supabase().from("lp_views").upsert(r, { onConflict: "slug,version,visitor_id,day", ignoreDuplicates: true });
  let { error } = await save(source ? { ...row, source } : row);
  // source 列をまだ Supabase に追加していないときは、目印なしで記録する
  if (error && source && /source/.test(error.message)) ({ error } = await save(row));
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
