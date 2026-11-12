import { NextResponse } from "next/server";
import { officeSnapshot } from "@/lib/office";

export const dynamic = "force-dynamic";

// オフィスの画面が数秒ごとに読みに来る（直近24時間の動きと吹き出し）
export async function GET() {
  return NextResponse.json(officeSnapshot(), { headers: { "Cache-Control": "no-store" } });
}
