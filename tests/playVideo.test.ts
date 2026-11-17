import "./setup";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { PLAY_SECONDS_MAX, PLAY_STEPS_MAX, makePlayVideo, parsePlayCheck, parsePlayScript, playSeconds, playVideoPath, renderPlay } from "../src/lib/playVideo";

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
  assert.equal(parsePlayScript({ hook: "h", caption: "c", steps: Array.from({ length: 20 }, () => ({ do: "click", target: "回す" })) })!.steps.length, Math.min(PLAY_STEPS_MAX, 7)); // 押す手順は1つ約1.6秒なので、15秒に入るのは7つまで
  // 動画の長さは上限（15秒）まで。超える分の手順は切る（PR #86 の ai-review の指摘）
  const long = parsePlayScript({ hook: "h", caption: "c", steps: [{ do: "click", target: "回す" }, ...Array.from({ length: 9 }, () => ({ do: "wait", ms: 3000 }))] })!;
  assert.deepEqual(long.steps.map((x) => x.do), ["click", "wait", "wait", "wait"]);
  assert.ok(playSeconds(long.steps) <= PLAY_SECONDS_MAX);
  // 待つだけで上限に達し、押す所まで届かない台本は使わない
  assert.equal(parsePlayScript({ hook: "h", caption: "c", steps: [...Array.from({ length: 5 }, () => ({ do: "wait", ms: 3000 })), { do: "click", target: "回す" }] }), null);
  // 一言と投稿文の案が欠けた台本は使わない（PR #86 の3回目の ai-review の指摘）
  const steps = [{ do: "click", target: "回す" }];
  assert.equal(parsePlayScript({ caption: "c", steps }), null);
  assert.equal(parsePlayScript({ hook: " ", caption: "c", steps }), null);
  assert.equal(parsePlayScript({ hook: "h", caption: 3, steps }), null);
  assert.ok(parsePlayScript({ hook: "h", caption: "c", steps }));
  // 動画のファイル名は決めた形だけ（ほかの場所のファイルを返さない）
  assert.ok(playVideoPath("play-12-1763380000000.mp4"));
  assert.ok(playVideoPath("play-12-1763380000000123456.mp4"));
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
  // 真ん中の手順が見つからなくても、途中のコマは撮り、コマは最初・途中・最後の3枚にそろう（PR #86 の ai-review の指摘）
  const r2 = await renderPlay({ hook: "x", caption: "", steps: [{ do: "click", target: "回す" }, { do: "click", target: "ないボタン" }, { do: "wait", ms: 300 }] }, html, {}, "改名スロット", out.replace("v.mp4", "v2.mp4"));
  assert.equal(r2.shots.length, 3);
  // 同じ文字のボタンが2つあり、先頭が隠れていても、見えている方を押す（PR #86 の3回目の ai-review の指摘）
  const twin = `<button style="display:none">回す</button><button id="v">回す</button><div id="o"></div><script>document.getElementById("v").onclick=()=>{document.getElementById("o").textContent="押せた";};</script>`;
  const r4 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "回す" }] }, twin, {}, "二つ", out.replace("v.mp4", "v4.mp4"));
  assert.equal(r4.done, 1);
  assert.deepEqual(r4.failed, []);
  // 幅で並びを変えるツールも、スマホの並び（360px 幅）で動かす（PR #86 の2回目の ai-review の指摘）
  const responsive = `<style>.narrow{display:none}@media (max-width:500px){.wide{display:none}.narrow{display:block}}</style>
<div class="wide"><button>PCで回す</button></div><div class="narrow"><button id="sp">スマホで回す</button></div><div id="w"></div>
<script>document.getElementById("sp").onclick=()=>{document.getElementById("w").textContent="幅 "+innerWidth;};</script>`;
  const r3 = await renderPlay({ hook: "x", caption: "", steps: [{ do: "click", target: "スマホで回す" }] }, responsive, {}, "幅", out.replace("v.mp4", "v3.mp4"));
  assert.equal(r3.done, 1);
  assert.deepEqual(r3.failed, []);
  // 入れられない入力欄は短い時間で諦め、録画は15秒を超えない（PR #86 のマージ後の ai-review の指摘）
  const locked = `<input id="n" disabled><button id="go">回す</button>`;
  const t0 = Date.now();
  const r5 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "fill", target: "#n", value: "やまだ" }, { do: "click", target: "回す" }] }, locked, {}, "止め", out.replace("v.mp4", "v5.mp4"));
  assert.equal(r5.done, 1);
  assert.match(r5.failed[0] ?? "", /1番目の「#n」を操作できなかった/);
  assert.ok(Date.now() - t0 < 20_000, `かかった時間 ${Date.now() - t0}ms`);
  // 台本の見積もりを超える手順は、録画の途中で打ち切る（コマは3枚そろう）
  const r6 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "回す" }, ...Array.from({ length: 6 }, () => ({ do: "wait" as const, ms: 3000 }))] }, locked, {}, "長い", out.replace("v.mp4", "v6.mp4"));
  assert.ok(r6.failed.some((x) => /15秒に収めるため/.test(x)));
  assert.equal(r6.shots.length, 3);
  const dur = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out.replace("v.mp4", "v6.mp4")], { encoding: "utf8" });
  if (dur.status === 0) assert.ok(Number(dur.stdout) <= 16, `動画の長さ ${dur.stdout.trim()}秒`);
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", out], { encoding: "utf8" });
  if (probe.status === 0) assert.equal(probe.stdout.trim(), "1080,1920");
});

test("遊ぶ様子の動画（PR #86 の ai-review の指摘）: 作っている途中に頼んでも断らず、順番に作る", async () => {
  // 案件がないので、どちらも順番に「作れない」で終わる（「いま別の動画を作っています」で断らない）
  const [a, b] = await Promise.allSettled([makePlayVideo(999_001), makePlayVideo(999_002)]);
  for (const x of [a, b]) {
    assert.equal(x.status, "rejected");
    assert.match(String((x as PromiseRejectedResult).reason), /動くツールの案件だけ/);
  }
  // 前のものが失敗しても、次は動く
  await assert.rejects(makePlayVideo(999_003), /動くツールの案件だけ/);
});

test("コマの確かめの答え（PR #86 の3回目の ai-review の指摘）: 読めない答えは問題なしにせず、確かめられなかったとして残す", () => {
  assert.deepEqual(parsePlayCheck('```json\n{"issues":[]}\n```'), { ok: true, issues: [] });
  assert.deepEqual(parsePlayCheck('{"issues":["結果が見えない"]}'), { ok: false, issues: ["結果が見えない"] });
  for (const bad of ["", "問題ありません", '{"issues":', '{"result":"ok"}', '{"issues":[null]}', '{"issues":[1]}', '{"issues":["x", 2]}']) {
    const c = parsePlayCheck(bad);
    assert.equal(c.ok, false, bad);
    assert.match(c.issues[0], /確かめの答えを読めなかった/);
  }
});
