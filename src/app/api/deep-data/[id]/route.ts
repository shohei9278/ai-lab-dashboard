import { db } from "@/lib/db";
import { isOwner } from "@/lib/viewer";

// じっくり案件のデータの下書きを、全部 JSON で保存する（人が確かめるため）。下書きはAIの出力なので、運営者だけ
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isOwner())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const row = db().prepare("SELECT project_id, spec, rows FROM deep_data WHERE id = ?").get(Number(id)) as { project_id: number; spec: string; rows: string } | undefined;
  if (!row) return new Response("Not found", { status: 404 });
  const body = JSON.stringify({ spec: JSON.parse(row.spec), rows: JSON.parse(row.rows) }, null, 2);
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="p${row.project_id}-data-${Number(id)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
