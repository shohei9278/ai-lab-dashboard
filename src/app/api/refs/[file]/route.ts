import fs from "node:fs";
import { refShotPath } from "@/lib/designRefs";

// デザインの参考の画面（ダッシュボードの中だけで見る）
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const p = refShotPath(file);
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
