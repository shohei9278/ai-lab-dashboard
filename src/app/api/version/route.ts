import { NextResponse } from "next/server";

// 動いている版のコミット（デプロイのあとの確認に使う）
export function GET() {
  return NextResponse.json({ commit: process.env.RAILWAY_GIT_COMMIT_SHA ?? null });
}
