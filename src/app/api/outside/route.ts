import { NextResponse } from "next/server";
import { addExternalVoice, deleteExternalVoice } from "@/lib/outside";

// 外の声: あなたが聞いた声を記録する・消す
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { projectId?: unknown; source?: unknown; text?: unknown; deleteId?: unknown };
  try {
    if (typeof body.deleteId === "number") {
      deleteExternalVoice(body.deleteId);
      return NextResponse.json({ ok: true });
    }
    const pid = Number(body.projectId);
    return NextResponse.json({ id: addExternalVoice({ projectId: Number.isFinite(pid) && pid > 0 ? pid : null, source: String(body.source ?? ""), text: String(body.text ?? "") }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
