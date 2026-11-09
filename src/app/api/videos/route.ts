import { NextResponse } from "next/server";
import { createRecordVideo } from "@/lib/recordVideo";
import type { RecordVideoKind } from "@/lib/recordVideoKinds";

// 実験の記録の動画を作る（人は「ゲスト」では呼べない。middleware が POST を止める）
export async function POST(req: Request) {
  try {
    const { kind } = (await req.json()) as { kind: RecordVideoKind };
    return NextResponse.json({ id: await createRecordVideo(kind) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
