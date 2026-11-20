// Claude Code で作ったツールに付けた、遊ぶ様子の動画の台本（<script type="application/json" id="lab-play">）を、
// 本番と同じ仕組み（renderPlay）で手元で録画して確かめる。AIは呼ばない（コマの確かめもしない。コマは自分の目で見る）
// 使い方: npx tsx scripts/play-check.mts <ツールのHTML> [ツール名] [--image 名前=ファイル ...]
//   画像（素材）を使うツールは、開発のカードに入れるのと同じ名前で --image を付ける（window.labAssets.images.名前 で読める）
//   → data/play-check/ に、動画（play.mp4）と、最初・途中・最後のコマ（shot-1〜3.jpg）を出し、できた手順・できなかった手順を表示する
// ローカルの ffmpeg と、Playwright のブラウザを使う
import fs from "node:fs";
import path from "node:path";
import { takePlayScript } from "../lp-site/src/lp/htmlDom";
import { parseGivenPlay, playSeconds, renderPlay } from "../src/lib/playVideo";
import { parseArgs } from "./toolImageArgs.mts";

const { positional, images } = parseArgs(process.argv.slice(2));
const [file, title = "ツール"] = positional;
if (!file) {
  console.error("使い方: npx tsx scripts/play-check.mts <ツールのHTML> [ツール名] [--image 名前=ファイル ...]");
  process.exit(1);
}
const play = takePlayScript(fs.readFileSync(file, "utf8"));
if (play.error) throw new Error(play.error);
if (play.json === null) throw new Error('台本（<script type="application/json" id="lab-play">）がありません');
const given = parseGivenPlay(JSON.parse(play.json));
if (typeof given === "string") throw new Error(`台本が使えません: ${given}`);

const out = path.resolve("data/play-check");
fs.mkdirSync(out, { recursive: true });
console.log(`手順 ${given.steps.length}つ・見積もり ${playSeconds(given.steps).toFixed(1)}秒で録画します…`);
const r = await renderPlay({ hook: given.hook ?? "（一言はAIが書きます）", caption: "", steps: given.steps }, play.html.trim(), { fonts: true, images }, title, path.join(out, "play.mp4"));
r.shots.forEach((b, i) => fs.writeFileSync(path.join(out, `shot-${i + 1}.jpg`), b));
console.log(`できた手順: ${r.done}つ`);
for (const f of r.failed) console.log(`できなかった: ${f}`);
console.log(`動画とコマ: ${out}`);
