import { NextResponse } from "next/server";
import { liveSnapshot } from "@/lib/live";
import { logEvent, practiceIdeas, simulateDays } from "@/lib/loop";

export const dynamic = "force-dynamic";

// ライブ画面が数秒ごとに読みに来る
export async function GET() {
  return NextResponse.json(liveSnapshot(), { headers: { "Cache-Control": "no-store" } });
}

// ライブ画面から、アイデア出しだけを始める（終わるまで待たずにすぐ返す。進み具合はライブ画面に流れる）
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; days?: number };
  if (body.action === "simulate") {
    const days = Math.min(7, Math.max(1, Number(body.days) || 5));
    simulateDays(days).catch((e) => logEvent(null, "system", "idea-error", `アイデア出しの仮テストに失敗: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)));
    return NextResponse.json({ ok: true });
  }
  practiceIdeas().catch((e) => logEvent(null, "system", "idea-error", `アイデア出し（見るだけ）に失敗: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300)));
  return NextResponse.json({ ok: true });
}
