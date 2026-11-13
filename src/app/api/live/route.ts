import { NextResponse } from "next/server";
import { liveSnapshot } from "@/lib/live";

export const dynamic = "force-dynamic";

// ホームのライブの欄が数秒ごとに読みに来る
// （練習用の「アイデア出しを見る」と仮テストを始めるPOSTは、呼ぶ画面がなくなったので消した。AIを呼ぶ指示は、ライブの欄の指示のボタンから）
export async function GET(req: Request) {
  return NextResponse.json(liveSnapshot({ guest: req.headers.get("x-viewer") !== "owner" }), { headers: { "Cache-Control": "no-store" } });
}
