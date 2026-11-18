import { approvedDeepData, getProject, type Lp } from "@/lib/loop";
import { isOwner } from "@/lib/viewer";

// じっくり案件を Claude Code で作る・直すときに使う、承認したデータ（JSON）と今のツールのHTML（運営者だけ）
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const p = getProject(Number(id));
  if (!p) return new Response("Not found", { status: 404 });
  const file = new URL(req.url).searchParams.get("file");
  if (file === "data") {
    const d = approvedDeepData(p.id);
    if (!d) return new Response("Not found", { status: 404 });
    return new Response(JSON.stringify(d.rows, null, 1), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (file === "tool") {
    const html = p.lp ? (JSON.parse(p.lp) as Lp).tool?.html : undefined;
    if (!html) return new Response("Not found", { status: 404 });
    return new Response(html, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  return new Response("Bad request", { status: 400 });
}
