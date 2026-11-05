import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { activityList, buildingList, ideaRunning } from "@/lib/loop";

export const dynamic = "force-dynamic";

// どのページの上にも出す「AIが作業中」の表示用。軽く、数秒ごとに読みに来る
export async function GET() {
  const titles = new Map((db().prepare("SELECT id, title FROM projects").all() as { id: number; title: string }[]).map((p) => [p.id, p.title]));
  const items = [
    ...activityList().map((a) => ({ key: a.key, title: a.title, detail: Object.entries(a.steps).map(([who, st]) => `${who.split(" ")[0]}: ${st}`).join(" ／ "), since: a.since })),
    ...buildingList().map((b) => ({ key: `b${b.id}`, title: titles.get(b.id) ?? `#${b.id}`, detail: `AIが${b.what}`, since: b.since })),
  ];
  return NextResponse.json({ items, ideaBusy: ideaRunning() }, { headers: { "Cache-Control": "no-store" } });
}
