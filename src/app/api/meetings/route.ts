import { NextResponse } from "next/server";
import { startAdhocMeeting } from "@/lib/adhoc";

// 臨時会議を今すぐ開く（裏で進め、進み具合はライブ画面、結果は会議室の議事録に出る）
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { topic?: unknown; members?: unknown };
  try {
    const members = Array.isArray(body.members) ? body.members.filter((m): m is string => typeof m === "string") : undefined;
    startAdhocMeeting(typeof body.topic === "string" ? body.topic : "", members);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
