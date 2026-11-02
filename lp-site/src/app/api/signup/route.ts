import { NextResponse } from "next/server";
import { getLp, supabase } from "@/lib/supabase";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  // ロボット対策の見えない欄に入力があれば、受け付けたふりをして保存しない
  if (body.website) return NextResponse.json({ ok: true });

  const email = String(body.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return NextResponse.json({ error: "メールアドレスを確認してください" }, { status: 400 });
  if (body.consent !== true) return NextResponse.json({ error: "プライバシーポリシーへの同意が必要です" }, { status: 400 });

  const lp = await getLp(String(body.slug ?? ""));
  if (!lp || lp.status !== "published") return NextResponse.json({ error: "このページの受付は終了しています" }, { status: 400 });

  // 同じメールで2回登録しても、1回として扱う（エラーにはしない）
  const { error } = await supabase()
    .from("signups")
    .upsert(
      { slug: lp.slug, version: lp.version, email, visitor_id: typeof body.visitorId === "string" ? body.visitorId.slice(0, 64) : null },
      { onConflict: "slug,email", ignoreDuplicates: true },
    );
  if (error) return NextResponse.json({ error: "送信できませんでした。時間をおいてもう一度お試しください。" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
