import { NextResponse } from "next/server";
import { buildDigest, sendNotify } from "@/lib/notify";

// 1日のまとめを、今すぐ試しに送る（設定の画面から）
export async function POST() {
  try {
    await sendNotify(buildDigest());
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
