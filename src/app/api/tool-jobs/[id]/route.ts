import { after, NextResponse } from "next/server";
import { db, type ApprovalRow } from "@/lib/db";
import { approvedDeepData, devRequestText, getProject, logEvent, startDevUpload, type Lp } from "@/lib/loop";
import { labTokenOk } from "@/lib/toolRoutine";

// 案件のツールを作るルーティン（クラウドの Claude Code）専用の入口（toolRoutine.ts・docs/routine-tool-build.md）
// 合言葉（LAB_TOOL_TOKEN）を Authorization: Bearer で送ったときだけ使える。[id] は開発待ちの番号
// できるのは、開発待ちの依頼文・データ・今のツールを読むことと、作ったツールを入れることと、入れたあとの様子を見ることだけ
// GET ?file=request（依頼文）/ data（承認したデータの JSON）/ tool（今のツールの HTML）/ status（開発待ちと案件の様子）
// POST {"html": "..."}: ツールを入れる。決まりに合わないときは 400 と理由を返す（直して入れ直せる）。入れたら、チェック・紹介ページづくりは裏で進める

function devApproval(id: string): ApprovalRow | undefined {
  const a = db().prepare("SELECT * FROM approvals WHERE id = ?").get(Number(id)) as ApprovalRow | undefined;
  return a?.kind === "dev" ? a : undefined;
}

const text = (body: string, type = "text/plain") => new Response(body, { headers: { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!labTokenOk(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const a = devApproval((await params).id);
  if (!a) return new Response("Not found", { status: 404 });
  const p = getProject(a.project_id);
  if (!p) return new Response("Not found", { status: 404 });
  const file = new URL(req.url).searchParams.get("file");
  if (file === "request") {
    const payload = JSON.parse(a.payload ?? "{}") as { design?: string; instruction?: string | null };
    return text(devRequestText(p.id, payload.design ?? "", payload.instruction ?? null));
  }
  if (file === "data") {
    const d = approvedDeepData(p.id);
    return d ? text(JSON.stringify(d.rows), "application/json") : new Response("Not found", { status: 404 });
  }
  if (file === "tool") {
    const html = p.lp ? (JSON.parse(p.lp) as Lp).tool?.html : undefined;
    return html ? text(html) : new Response("Not found", { status: 404 });
  }
  if (file === "status") {
    // 入れたあと、チェック・動作の確かめ・紹介ページづくりがどこまで進んだか（案件の今の判断待ちと、新しい経過）
    const pending = db().prepare("SELECT kind, proposal FROM approvals WHERE project_id = ? AND status = 'pending' ORDER BY id").all(p.id) as { kind: string; proposal: string }[];
    const events = db().prepare("SELECT at, kind, message FROM events WHERE project_id = ? AND at >= ? ORDER BY id DESC LIMIT 15").all(p.id, a.created_at) as { at: string; kind: string; message: string }[];
    return NextResponse.json({ approval: { id: a.id, status: a.status }, project: { id: p.id, stage: p.stage, lpVersion: p.lp_version, publicVersion: p.public_version }, pending, events }, { headers: { "Cache-Control": "no-store" } });
  }
  return new Response("Bad request", { status: 400 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!labTokenOk(req.headers.get("authorization"))) return new Response("Unauthorized", { status: 401 });
  const a = devApproval((await params).id);
  if (!a) return new Response("Not found", { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { html?: unknown };
  let job: Promise<void>;
  try {
    job = startDevUpload(a.id, typeof body.html === "string" ? body.html : "", "Claude Code（ルーティン）");
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  const done = job.catch((e) => logEvent(a.project_id, "system", "background-error", `ルーティンが入れたツールの取り込みに失敗しました: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`));
  try {
    after(() => done);
  } catch {
    void done;
  }
  return NextResponse.json({ accepted: true }, { status: 202 });
}
