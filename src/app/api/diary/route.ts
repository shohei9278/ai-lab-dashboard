import { NextResponse } from "next/server";
import { createDiary } from "@/lib/diary";

// 今日の日報を今すぐ書く（すでにあれば書き直す）
export async function POST() {
  try {
    return NextResponse.json({ id: await createDiary({ force: true }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
