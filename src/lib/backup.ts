import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { dataDir, db } from "./db";
import { publishingConfigured, sb } from "./publish";

// データベースの写しを、毎日1回 data/backups/ に日付つきで取る（書き込み中でも壊れない SQLite のバックアップ機能を使う）
// 同じ場所の写しは、ボリュームごと失うと一緒に消えるので、Supabase の非公開の保存領域にも圧縮して送る
// 戻すとき: Supabase の Storage（db-backups）から戻したい日の .gz を取り出して展開し、サーバーを止めて、データベースのファイルと置き換える

const KEEP = 14;
const OFFSITE_KEEP = 30;
const OFFSITE_BUCKET = "db-backups";
const OFFSITE_NAME = /^ai-lab-\d{4}-\d{2}-\d{2}\.db\.gz$/;
const RETRY_MS = 3_600_000; // 失敗したら1時間おきにやり直す

const gzipAsync = promisify(gzip);
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

export type OffsiteState = { file: string; at: string; bytes: number };

const offsitePath = () => path.join(dataDir("backups"), "offsite.json");

export function offsiteState(): OffsiteState | null {
  try {
    return JSON.parse(fs.readFileSync(offsitePath(), "utf8")) as OffsiteState;
  } catch {
    return null;
  }
}

// 外の保存領域で、古いので消すファイル（日付つきの写しだけを数える）
export function expiredOffsite(names: string[], keep = OFFSITE_KEEP): string[] {
  return names.filter((n) => OFFSITE_NAME.test(n)).sort().reverse().slice(keep);
}

// 写しを圧縮して送り、送った大きさを返す。保存領域がまだ無ければ非公開で作る
export async function pushOffsite(localPath: string, remoteName: string): Promise<number> {
  const bytes = await gzipAsync(fs.readFileSync(localPath));
  const storage = sb().storage;
  const upload = () => storage.from(OFFSITE_BUCKET).upload(remoteName, bytes, { contentType: "application/gzip", upsert: true });
  let { error } = await upload();
  if (error && /not found|does not exist/i.test(error.message)) {
    const made = await storage.createBucket(OFFSITE_BUCKET, { public: false });
    if (made.error && !/already exists/i.test(made.error.message)) throw new Error(`保存領域を作れませんでした: ${made.error.message}`);
    ({ error } = await upload());
  }
  if (error) throw new Error(error.message);
  return bytes.length;
}

async function pruneOffsite() {
  const { data, error } = await sb().storage.from(OFFSITE_BUCKET).list("", { limit: 1000 });
  if (error) throw new Error(error.message);
  const old = expiredOffsite((data ?? []).map((f) => f.name));
  if (!old.length) return;
  const removed = await sb().storage.from(OFFSITE_BUCKET).remove(old);
  if (removed.error) throw new Error(removed.error.message);
}

let lastTry = 0;

// 一番新しい写しがまだ外に無ければ送る（5分ごとの見回りから呼ぶ）。送れたら内容を返す
export async function maybeOffsiteBackup(): Promise<OffsiteState | null> {
  if (!publishingConfigured() || Date.now() - lastTry < RETRY_MS) return null;
  const latest = backupList()[0];
  if (!latest || offsiteState()?.file === latest.file) return null;
  lastTry = Date.now();
  const bytes = await pushOffsite(path.join(dataDir("backups"), latest.file), `${latest.file}.gz`);
  const state: OffsiteState = { file: latest.file, at: new Date().toISOString(), bytes };
  fs.writeFileSync(offsitePath(), JSON.stringify(state));
  await pruneOffsite();
  return state;
}
