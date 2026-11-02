import { NextResponse } from "next/server";
import { refreshTrends } from "@/lib/trends";

// 世の中の話題を今すぐ取り直す
export async function POST() {
  return NextResponse.json(await refreshTrends());
}
