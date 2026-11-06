// このPCのダッシュボードのデータを、サーバーのダッシュボードに移す
//   npx tsx scripts/push-db.mts https://〇〇.up.railway.app [--force]
// パスワードは実行中に聞く（画面には表示しない）。--force はサーバーに実案件があっても上書きする
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const url = process.argv[2]?.replace(/\/$/, "");
const force = process.argv.includes("--force");
if (!url || !/^(https:\/\/|http:\/\/localhost[:/])/.test(url + "/")) throw new Error("サーバーのURL（https://〜）を指定してください");

function askHidden(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let muted = false;
  out._writeToOutput = (s) => { if (!muted) out.output.write(s); };
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
    muted = true;
  });
}

const user = process.env.DASHBOARD_USER || "admin";
const password = await askHidden(`サーバーのダッシュボードのパスワード（ユーザー名 ${user}）: `);

// 書き込み途中の内容も含めて、一貫した状態の中身を取り出す
const file = process.env.AI_LAB_DB ?? path.join(process.cwd(), "data", "ai-lab.db");
const local = new Database(file, { readonly: true });
const n = (local.prepare("SELECT COUNT(*) AS n FROM projects").get() as { n: number }).n;
const bytes = local.serialize();
local.close();
console.log(`送信します: 案件 ${n}件（${(bytes.length / 1024 / 1024).toFixed(1)}MB）`);

const res = await fetch(`${url}/api/admin/import-db${force ? "?force=1" : ""}`, {
  method: "POST",
  headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "Content-Type": "application/octet-stream" },
  body: bytes,
});
const text = await res.text();
let data: { ok?: boolean; error?: string; projects?: number } = {};
try { data = JSON.parse(text); } catch {}
if (res.status === 401 || (res.status === 403 && /公開中のデモ/.test(text))) {
  console.error("パスワードが違います");
  process.exit(1);
}
if (!res.ok) {
  console.error(`失敗しました（${res.status}）: ${data.error ?? text.slice(0, 200)}`);
  process.exit(1);
}
console.log(`DBを移しました。サーバーの案件: ${data.projects}件`);

// DB の外にあるファイル（ツールのテストやページの画面の写真・デザインの参考の画面・ブランドの画像）も送る
const dataRoot = path.dirname(file);
let sent = 0;
let failed = 0;
for (const dir of ["screenshots", "refs", "brand"]) {
  const full = path.join(dataRoot, dir);
  if (!fs.existsSync(full)) continue;
  for (const name of fs.readdirSync(full)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || !fs.statSync(path.join(full, name)).isFile()) continue;
    const r = await fetch(`${url}/api/admin/import-file`, {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`, "Content-Type": "application/octet-stream", "x-file-path": `${dir}/${name}` },
      body: fs.readFileSync(path.join(full, name)),
    });
    if (r.ok) sent++;
    else failed++;
  }
}
console.log(`画面の写真などのファイルを ${sent}件送りました${failed ? `（失敗 ${failed}件）` : ""}`);
console.log("完了しました");
