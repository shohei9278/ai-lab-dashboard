import "./setup";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { PLAY_STEPS_MAX, parsePlayScript, playVideoPath, renderPlay } from "../src/lib/playVideo";

test("遊ぶ様子の動画の台本: 決めた形にそろえ、押す所がない台本は使わない", () => {
  const s = parsePlayScript({
    hook: "名前を入れると、勝手に改名される！！！！！（長い一言）",
    steps: [
      { do: "fill", target: " #name ", value: "やまだ" },
      { do: "click", target: "回す" },
      { do: "wait", ms: 99_999 },
      { do: "wait" },
      { do: "jump", target: "x" },
      { do: "click", target: "" },
    ],
    caption: "a".repeat(300),
  })!;
  assert.equal(s.hook.length, 24);
  assert.deepEqual(s.steps, [{ do: "fill", target: "#name", value: "やまだ" }, { do: "click", target: "回す" }, { do: "wait", ms: 3000 }, { do: "wait", ms: 800 }]);
  assert.equal(s.caption.length, 200);
  // 押す所がない・形が違うものは使わない
  assert.equal(parsePlayScript({ steps: [{ do: "wait", ms: 500 }] }), null);
  assert.equal(parsePlayScript({ hook: "x" }), null);
  // 手順は決めた数まで
  assert.equal(parsePlayScript({ steps: Array.from({ length: 20 }, () => ({ do: "click", target: "回す" })) })!.steps.length, PLAY_STEPS_MAX);
  // 動画のファイル名は決めた形だけ（ほかの場所のファイルを返さない）
  assert.ok(playVideoPath("play-12-1763380000000.mp4"));
  assert.equal(playVideoPath("../play-1-2.mp4"), null);
  assert.equal(playVideoPath("record-1.mp4"), null);
});

test("遊ぶ様子の動画: 台本どおりに入れて押し、縦長の動画とコマを作る。見つからない所は飛ばして知らせる（ブラウザと ffmpeg があるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  await browser.close();
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg がありません");
  const html = `<input id="name" placeholder="あなたの名前"><button id="go">回す</button><div id="r"></div>
<script>document.getElementById("go").onclick=()=>{document.getElementById("r").textContent="今日から「"+(document.getElementById("name").value||"あなた")+"」だ";};</script>`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "play-")), "v.mp4");
  const r = await renderPlay({ hook: "名前を入れると改名される", caption: "", steps: [{ do: "fill", target: "#name", value: "やまだ" }, { do: "click", target: "回す" }, { do: "click", target: "ないボタン" }] }, html, {}, "改名スロット", out);
  assert.equal(r.done, 2);
  assert.deepEqual(r.failed, ["3番目の「ないボタン」が見つからなかった"]);
  assert.equal(r.shots.length, 3);
  assert.ok(fs.statSync(out).size > 10_000);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8" });
  if (probe.status === 0) assert.equal(probe.stdout.trim(), "1080,1920");
});
