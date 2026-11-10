import { NextResponse } from "next/server";
import { createRecordVideo } from "@/lib/recordVideo";
import type { RecordVideoKind } from "@/lib/recordVideoKinds";

// 実験の記録の動画を作る（人は「ゲスト」では呼べない。middleware が POST を止める）
export async function POST(req: Request) {
  try {
    const { kind, instruction } = (await req.json()) as { kind: RecordVideoKind; instruction?: unknown };
    return NextResponse.json({ id: await createRecordVideo(kind, typeof instruction === "string" ? instruction : undefined) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
