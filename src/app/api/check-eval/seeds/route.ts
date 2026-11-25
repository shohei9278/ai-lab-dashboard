import { NextResponse } from "next/server";
import { decideEvalSeed } from "@/lib/evalSeeds";

// 試験問題の候補を決める（ok / ng で試験に入れる・dismiss で入れない）。運営者だけ（proxy.ts が来訪者の POST を断る）
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: unknown; decision?: unknown; type?: unknown };
  try {
    const row = decideEvalSeed(Number(body.id), body.decision, body.type);
    return NextResponse.json({ ok: true, status: row.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
