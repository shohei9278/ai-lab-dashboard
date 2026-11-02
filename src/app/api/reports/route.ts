import { NextResponse } from "next/server";
import { GuardError } from "@/lib/ai";
import { createReport } from "@/lib/report";

// 週のレポートを今すぐ作る
export async function POST() {
  try {
    return NextResponse.json({ id: await createReport() });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof GuardError ? 403 : 500 });
  }
}
