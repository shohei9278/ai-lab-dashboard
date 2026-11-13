import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { showcaseOfficeSnapshot } from "@/lib/office";

export const dynamic = "force-dynamic";

// 概要ページのオフィスが数秒ごとに読みに来る。概要ページを出さない設定のときは、ページと同じく 404
export async function GET() {
  if (!getSettings().showcaseEnabled) return new NextResponse("Not found", { status: 404 });
  return NextResponse.json(showcaseOfficeSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
