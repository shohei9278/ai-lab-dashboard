import fs from "node:fs";
import path from "node:path";
import { dataDir, db } from "./db";

// データベースの写しを、毎日1回 data/backups/ に日付つきで取る（書き込み中でも壊れない SQLite のバックアップ機能を使う）
// 直近14日分だけ残す。フォルダが Dropbox の中にあれば、写しはPCの外にも同期される
// 戻すとき: サーバーを止めて、戻したい日の写しを data/ai-lab.db に置き換える

const KEEP = 14;

const jstDay = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

export function backupList(): { file: string; bytes: number }[] {
  const dir = dataDir("backups");
  return fs.readdirSync(dir).filter((f) => /^ai-lab-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().reverse()
    .map((f) => ({ file: f, bytes: fs.statSync(path.join(dir, f)).size }));
}

export async function maybeDailyBackup(): Promise<string | null> {
  const dir = dataDir("backups");
  const file = `ai-lab-${jstDay()}.db`;
  if (fs.existsSync(path.join(dir, file))) return null;
  await db().backup(path.join(dir, file));
  for (const old of backupList().slice(KEEP)) fs.rmSync(path.join(dir, old.file), { force: true });
  return file;
}
