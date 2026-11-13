import { NextResponse } from "next/server";
import { officeSnapshot } from "@/lib/office";

export const dynamic = "force-dynamic";

// オフィスの画面が数秒ごとに読みに来る（直近24時間の動きと吹き出し）
export async function GET(req: Request) {
  return NextResponse.json(officeSnapshot({ guest: req.headers.get("x-viewer") !== "owner" }), { headers: { "Cache-Control": "no-store" } });
}
