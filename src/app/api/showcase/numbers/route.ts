import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { showcaseNumbers } from "@/lib/showcaseNumbers";

export const dynamic = "force-dynamic";

// 実験の概要ページと同じ数字を、ほかのサイト（ポートフォリオ）からも読めるようにする（src/lib/showcaseNumbers.ts）
// 概要ページを出さない設定のときは、ページと同じく 404。読むだけなので、どのサイトからでも読めるようにする
const headers = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };

export async function GET() {
  if (!getSettings().showcaseEnabled) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(showcaseNumbers(), { headers });
}
