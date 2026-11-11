import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { dataDir } from "@/lib/db";

// このPCの画面の写真など（DB の外のファイル）をサーバーに移すための入口（scripts/push-db.mts から使う）
// 運営者だけが使える（来た人の POST は proxy が断る）。置ける場所は決まったフォルダの中だけ
const ALLOWED = /^(screenshots|refs|brand)\/[A-Za-z0-9._-]+$/;

export async function POST(req: Request) {
  if (!process.env.DASHBOARD_PASSWORD || req.headers.get("x-viewer") !== "owner") {
    return NextResponse.json({ error: "パスワード保護が有効なサーバーで、運営者だけが使えます" }, { status: 403 });
  }
  const rel = req.headers.get("x-file-path") ?? "";
  if (!ALLOWED.test(rel) || rel.includes("..")) return NextResponse.json({ error: "置けない場所です" }, { status: 400 });
  const [dir, name] = rel.split("/");
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) return NextResponse.json({ error: "ファイルが空か大きすぎます" }, { status: 400 });
  fs.writeFileSync(path.join(dataDir(dir), name), bytes);
  return NextResponse.json({ ok: true });
}
