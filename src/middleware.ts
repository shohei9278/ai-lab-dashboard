import { NextResponse, type NextRequest } from "next/server";
import { OWNER_COOKIE, ownerToken } from "@/lib/ownerToken";

// サーバーに置いたときは、だれでも閲覧だけできる（ポートフォリオとして見せるため）。操作できるのはログインした運営者だけ
// - DASHBOARD_PASSWORD を設定しなければ、このPCで動かすときと同じく、すべて運営者として開ける
// - 運営者かどうかは、/login で付けるクッキーか、Basic 認証（スクリプト用）で確かめる
// - 来た人の操作（GET 以外の呼び出し）は、ここで全部断る。費用がかかる操作も、データの変更もできない
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // 画面の外枠（メニューなど）を出し分けるために、開いているページと、見ている人を伝える（外から送られた値は使わない）
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname);
  headers.delete("x-viewer");
  const pass = (viewer: "owner" | "guest") => {
    headers.set("x-viewer", viewer);
    return NextResponse.next({ request: { headers } });
  };
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return pass("owner");
  if (await isOwnerRequest(req, password)) return pass("owner");

  const method = req.method.toUpperCase();
  if (pathname === "/api/login" && method === "POST") return pass("guest");
  if (method !== "GET" && method !== "HEAD") {
    return NextResponse.json({ error: "公開中のデモでは操作できません（実際の操作では、AIやAPIの費用がかかります）" }, { status: 403 });
  }
  // 開くだけで登録が走るページ（ブックマークレットの窓）と、他人のサイトの画面は、来た人には出さない
  if (pathname === "/refs/add" || pathname === "/viral/add") return NextResponse.redirect(new URL("/login", req.url));
  if (pathname.startsWith("/api/refs/")) return new NextResponse("公開中のデモでは表示しません", { status: 403 });
  return pass("guest");
}

async function isOwnerRequest(req: NextRequest, password: string): Promise<boolean> {
  const cookie = req.cookies.get(OWNER_COOKIE)?.value;
  if (cookie && same(cookie, await ownerToken(password))) return true;
  const user = process.env.DASHBOARD_USER || "admin";
  const header = req.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  let decoded = "";
  try {
    decoded = atob(header.slice(6));
  } catch {}
  const i = decoded.indexOf(":");
  return i >= 0 && same(decoded.slice(0, i), user) && same(decoded.slice(i + 1), password);
}

// 比べる時間で中身が推測されないよう、最後まで比べる
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
