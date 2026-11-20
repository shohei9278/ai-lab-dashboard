// Claude Code で作ったツールを、公開サイトと同じ枠（CSP・window.labAssets・labShare など）に入れたページにして、手元のブラウザで確かめる
// 使い方: npx tsx scripts/tool-preview.mts <ツールのHTML> [--image 名前=ファイル ...]
//   → data/tool-preview/index.html を出す（ブラウザで開く。画像は data: の URL として埋め込む）
import fs from "node:fs";
import path from "node:path";
import { takePlayScript } from "../lp-site/src/lp/htmlDom";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";
import { parseArgs } from "./toolImageArgs.mts";

const { positional, images } = parseArgs(process.argv.slice(2));
const [file] = positional;
if (!file) {
  console.error("使い方: npx tsx scripts/tool-preview.mts <ツールのHTML> [--image 名前=ファイル ...]");
  process.exit(1);
}
const play = takePlayScript(fs.readFileSync(file, "utf8"));
if (play.error) throw new Error(play.error);
const out = path.resolve("data/tool-preview");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), wrapToolHtml(play.html.trim(), { fonts: true, images }));
console.log(`手元で開くページ: ${path.join(out, "index.html")}${images ? `（画像 ${Object.keys(images).join("・")}）` : ""}`);
