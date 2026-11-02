import { NextResponse, type NextRequest } from "next/server";

// サーバーに置いたときは、パスワードを知っている人だけが開けるようにする
// （DASHBOARD_PASSWORD を設定しなければ、このPCで動かすときと同じくそのまま開ける）
export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();
  const user = process.env.DASHBOARD_USER || "admin";
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    let decoded = "";
    try {
      decoded = atob(header.slice(6));
    } catch {}
    const i = decoded.indexOf(":");
    if (i >= 0 && same(decoded.slice(0, i), user) && same(decoded.slice(i + 1), password)) return NextResponse.next();
  }
  return new NextResponse("ログインが必要です", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="AI Product Lab", charset="UTF-8"' },
  });
}

// 比べる時間で中身が推測されないよう、最後まで比べる
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
