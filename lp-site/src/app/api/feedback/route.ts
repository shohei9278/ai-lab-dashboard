import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";

// 利用者の声（匿名）を受け取る。ツールは「使ってみてどうだったか」、事前登録LPは「登録しなかった理由」
const CHOICES = {
  tool: new Set(["useful", "confusing", "not_what_i_want", "other"]),
  lp: new Set(["not_now", "unclear", "distrust", "other"]),
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // ロボット対策の見えない欄に入力があれば、受け付けたふりをして保存しない
  if (body.website) return NextResponse.json({ ok: true });
  const lp = await getLp(String(body.slug ?? ""));
  if (!lp || lp.status !== "published" || Number(body.version) !== lp.version) return NextResponse.json({ ok: false }, { status: 400 });
  const kind = lp.content.tool ? "tool" : "lp";
  const choice = String(body.choice ?? "");
  if (!CHOICES[kind].has(choice)) return NextResponse.json({ ok: false }, { status: 400 });
  // 運営者のブラウザ（?me=1）からは、確かめるだけで保存しない
  if (body.test === true) return NextResponse.json({ ok: true });
  // URL・メールアドレス・電話番号らしきものは消す（個人の情報や宣伝を残さないため）
  const text = String(body.text ?? "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "")
    .replace(/\d{2,4}-?\d{2,4}-?\d{3,4}/g, "")
    .trim()
    .slice(0, 300);
  const visitorId = String(body.visitorId ?? "").slice(0, 64) || "anonymous";
  const { error } = await supabase()
    .from("feedback")
    .upsert({ slug: lp.slug, version: lp.version, visitor_id: visitorId, kind, choice, text }, { onConflict: "slug,version,visitor_id", ignoreDuplicates: true });
  // 表をまだ作っていないときは、黙って捨てる
  if (error) return NextResponse.json({ ok: false }, { status: /feedback/.test(error.message) ? 200 : 500 });
  return NextResponse.json({ ok: true });
}
