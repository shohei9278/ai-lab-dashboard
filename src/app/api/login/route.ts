import { NextResponse } from "next/server";
import { OWNER_COOKIE, ownerToken } from "@/lib/ownerToken";

// 運営者のログイン・ログアウト
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: unknown; logout?: unknown };
  const res = NextResponse.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:";
  if (body.logout === true) {
    res.cookies.set(OWNER_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
    return res;
  }
  const password = process.env.DASHBOARD_PASSWORD;
  // 総当たりを遅くする
  await new Promise((r) => setTimeout(r, 800));
  if (!password || typeof body.password !== "string" || body.password !== password) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }
  res.cookies.set(OWNER_COOKIE, await ownerToken(password), { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 60 * 60 * 24 * 30 });
  return res;
}
