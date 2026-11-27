import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";
import { trackedInApp } from "@/lp/inApp";
import { recordView } from "@/lp/trackView";

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
  const table = () => supabase().from("lp_views");
  // lp_views の day の既定と同じ、日本の日付
  const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  // アプリの中のブラウザか（アプリの種類・アプリの外なら ""。古いページからは届かないので、そのときは入れない）
  const { error } = await recordView(
    {
      insert: async (r) => table().upsert(r, { onConflict: "slug,version,visitor_id,day", ignoreDuplicates: true }),
      fillInApp: async (key, inapp, src) => {
        let q = table().update({ inapp }).eq("slug", key.slug).eq("version", key.version).eq("visitor_id", key.visitor_id).eq("day", today());
        q = inapp ? q.or('inapp.is.null,inapp.eq.""') : q.is("inapp", null);
        if (src !== undefined) q = src === null ? q.is("source", null) : q.eq("source", src);
        return q;
      },
    },
    row,
    source,
    trackedInApp(body.inapp),
  );
  if (error) return NextResponse.json({ ok: false }, { status: 500 });
  return NextResponse.json({ ok: true });
}
