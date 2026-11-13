import fs from "node:fs";
import { getSettings } from "@/lib/db";
import { showcaseShotFile } from "@/lib/showcase";
import { screenshotPath } from "@/lib/toolTest";

export const dynamic = "force-dynamic";

// 概要ページの案件のカードの画面写真。概要ページに載せる案件の、公開した版の写真だけを返す（未公開の版・候補の写真は返さない）
// 概要ページを出さない設定のときは、ページと同じく 404
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!getSettings().showcaseEnabled) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const file = /^\d+$/.test(id) ? showcaseShotFile(Number(id)) : null;
  const p = file ? screenshotPath(file) : null;
  if (!file || !p) return new Response("Not found", { status: 404 });
  return new Response(fs.readFileSync(p), { headers: { "Content-Type": file.endsWith(".jpg") ? "image/jpeg" : "image/png", "Cache-Control": "no-store" } });
}
