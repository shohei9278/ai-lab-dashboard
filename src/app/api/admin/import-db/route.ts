import { NextResponse } from "next/server";
import { db, replaceDatabase } from "@/lib/db";

// このPCのDBをサーバーに移すための入口（scripts/push-db.mts から使う）
// パスワード保護が有効なサーバーでだけ使える。すでに実案件があるときは、明示しない限り上書きしない
export async function POST(req: Request) {
  if (!process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: "パスワード保護が有効なサーバーでだけ使えます" }, { status: 403 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  const existing = (db().prepare("SELECT COUNT(*) AS n FROM projects WHERE demo = 0").get() as { n: number }).n;
  if (existing > 0 && !force) {
    return NextResponse.json({ error: `サーバーにはすでに実案件が${existing}件あります。上書きするなら --force を付けてください` }, { status: 409 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.length < 100 || bytes.subarray(0, 15).toString() !== "SQLite format 3") {
    return NextResponse.json({ error: "SQLite のファイルではありません" }, { status: 400 });
  }
  try {
    return NextResponse.json({ ok: true, ...replaceDatabase(bytes) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
