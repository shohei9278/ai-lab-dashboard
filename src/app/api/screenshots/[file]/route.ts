import fs from "node:fs";
import { screenshotPath } from "@/lib/toolTest";

// ツールの自動テスト・LPのデザイン確認で撮った画面の写真
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const p = screenshotPath(file);
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "Content-Type": file.endsWith(".jpg") ? "image/jpeg" : "image/png", "Cache-Control": "no-store" } });
}
