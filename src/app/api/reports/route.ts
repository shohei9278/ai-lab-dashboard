import { NextResponse } from "next/server";
import { GuardError } from "@/lib/ai";
import { createWeeklyMeeting } from "@/lib/weekly";

// 週の定例会議を今すぐ開く（議事録と発信用の下書きができる）
export async function POST() {
  try {
    return NextResponse.json({ id: await createWeeklyMeeting() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof GuardError ? 403 : 500 });
  }
}
