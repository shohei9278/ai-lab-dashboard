import { NextResponse } from "next/server";
import { addIntervention, hideIntervention } from "@/lib/interventions";

// 人の手が入った記録を足す・消す（ゲストは middleware が POST を止める）
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.action === "hide") {
      hideIntervention(Number(body.id));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ id: addIntervention(body) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
