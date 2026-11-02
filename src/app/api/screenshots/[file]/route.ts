import fs from "node:fs";
import { screenshotPath } from "@/lib/toolTest";

// ツールの自動テストで撮った画面の写真
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const p = screenshotPath(file);
  if (!p) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
}
