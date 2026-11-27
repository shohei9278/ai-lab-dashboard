import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";
import { trackedInApp } from "@/lp/inApp";

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
  // アプリの中のブラウザか（アプリの種類・アプリの外なら ""。古いページからは届かないので、そのときは入れない）
  const inapp = trackedInApp(body.inapp);
  const extra: Record<string, unknown> = { ...(source ? { source } : {}), ...(inapp !== null ? { inapp } : {}) };
  let { error } = await save({ ...row, ...extra });
  // inapp 列・source 列をまだ Supabase に追加していないときは、その列なしで記録し直す
  for (const col of ["inapp", "source"]) {
    if (error && col in extra && new RegExp(col).test(error.message)) {
      delete extra[col];
      ({ error } = await save({ ...row, ...extra }));
    }
  }
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
