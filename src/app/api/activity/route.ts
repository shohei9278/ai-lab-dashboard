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
  // 画面を自動で新しくするための印。裏の作業（取り込み・AIのまとめ・作成・判断など）でデータが変わると、この値が変わる
  const v = db().prepare(
    `SELECT (SELECT COALESCE(MAX(id), 0) FROM events) || '.' || (SELECT COUNT(*) FROM approvals WHERE status = 'pending')
       || '.' || (SELECT COALESCE(MAX(id), 0) FROM lp_versions) || '.' || (SELECT COUNT(*) FROM viral_posts WHERE status != 'queued')
       || '.' || (SELECT COUNT(*) FROM design_refs WHERE status != 'queued') || '.' || (SELECT COUNT(*) FROM user_wants)
       || '.' || (SELECT COUNT(*) FROM sns_comments) || '.' || (SELECT COUNT(*) FROM sns_posts) || '.' || (SELECT COALESCE(SUM(visits), 0) FROM metrics)
       || '.' || (SELECT COALESCE(MAX(id), 0) FROM meetings) || '.' || (SELECT COUNT(*) FROM voices) || '.' || (SELECT COUNT(*) FROM plan_requests WHERE status = 'open') AS v`,
  ).get() as { v: string };
  return NextResponse.json({ items, ideaBusy: ideaRunning(), version: v.v }, { headers: { "Cache-Control": "no-store" } });
}
