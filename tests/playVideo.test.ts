import "./setup";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { FAST_MAX, FAST_WAIT_MAX, PLAY_SECONDS_MAX, bandTitle, fastSlack, PLAY_STEPS_MAX, makePlayVideo, parsePlayCheck, parsePlayScript, playSeconds, playVideoPath, renderPlay } from "../src/lib/playVideo";

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
  assert.equal(parsePlayScript({ hook: "h", caption: "c", steps: Array.from({ length: 20 }, () => ({ do: "click", target: "回す" })) })!.steps.length, Math.min(PLAY_STEPS_MAX, 10)); // 押す手順は1つ約1.2秒なので、15秒に入るのは10まで（#66 の動画で短くした。前は1.6秒・7つまで）
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
  // 見つからなかったときは、見えているボタンの名前を添える（#66 の動画）
  assert.deepEqual(r.failed, ["3番目の「ないボタン」が見つからなかった（見えているボタン: 回す）"]);
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
  if (dur.status === 0) assert.ok(Number(dur.stdout) <= 15.1, `動画の長さ ${dur.stdout.trim()}秒`);
  // 押せないボタンで操作が見積もりより遅れても、動画は15秒で切る（PR #87 の ai-review の指摘）
  const covered = `<button id="go">回す</button><div style="position:fixed;inset:0;background:rgba(0,0,0,.01)"></div>`;
  const r7 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "wait", ms: 3000 }, { do: "wait", ms: 3000 }, { do: "wait", ms: 2400 }, { do: "click", target: "回す" }, { do: "wait", ms: 300 }] }, covered, {}, "覆い", out.replace("v.mp4", "v7.mp4"));
  assert.ok(r7.failed.some((x) => /操作できなかった/.test(x)), r7.failed.join(" / "));
  const dur7 = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out.replace("v.mp4", "v7.mp4")], { encoding: "utf8" });
  if (dur7.status === 0) assert.ok(Number(dur7.stdout) <= 15.1, `動画の長さ ${dur7.stdout.trim()}秒`);
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

test("遊ぶ様子の動画の台本（#62 で運営者が見つけた）: ドラッグの手順を読む。動かさないドラッグは使わず、ドラッグだけの台本も使える", () => {
  const s = parsePlayScript({
    hook: "h", caption: "c",
    steps: [
      { do: "drag", target: " #paper ", dx: 0.3, dy: -2, from: [0.2, 1.5] },
      { do: "drag", target: "#paper", dx: 0, dy: 0 },
      { do: "drag", target: "#paper", dx: "x", dy: 0.4, from: "真ん中" },
      { do: "drag", target: "", dx: 0.5 },
    ],
  })!;
  assert.deepEqual(s.steps, [
    { do: "drag", target: "#paper", dx: 0.3, dy: -1, from: [0.2, 1] },
    { do: "drag", target: "#paper", dx: 0, dy: 0.4 },
  ]);
  // ドラッグは1つ約1.9秒
  assert.ok(Math.abs(playSeconds(s.steps) - (0.7 + 1.9 * 2 + 2.2)) < 1e-9);
});

test("遊ぶ様子の動画（#62 で運営者が見つけた）: ドラッグで動かすと押せるようになるボタンも、台本どおりに動かして押せる（ブラウザと ffmpeg があるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  await browser.close();
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg がありません");
  // 押さえた所からの相対で動く板。動かすまで「決める」は押せない
  const html = `<div id="board" style="position:relative;width:300px;height:300px;background:#eee;touch-action:none"><div id="dot" style="position:absolute;left:20px;top:20px;width:30px;height:30px;border-radius:50%;background:#000"></div></div>
<button id="ok" disabled>決める</button><div id="out"></div>
<script>var b=document.getElementById("board"),d=document.getElementById("dot"),x=20,y=20,s=null;
b.addEventListener("pointerdown",function(e){s={x:e.clientX,y:e.clientY,ox:x,oy:y};b.setPointerCapture(e.pointerId)});
b.addEventListener("pointermove",function(e){if(!s)return;x=s.ox+e.clientX-s.x;y=s.oy+e.clientY-s.y;d.style.left=x+"px";d.style.top=y+"px";document.getElementById("ok").disabled=false});
b.addEventListener("pointerup",function(){s=null});
document.getElementById("ok").onclick=function(){document.getElementById("out").textContent="置いた "+Math.round(x)+","+Math.round(y)};</script>`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "play-")), "d.mp4");
  const r = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "決める" }, { do: "drag", target: "#board", dx: 0.4, dy: 0.2 }, { do: "click", target: "決める" }] }, html, {}, "置く", out);
  // 動かす前の「決める」は押せず、動かしたあとは押せる
  assert.match(r.failed.join(" / "), /1番目の「決める」を操作できなかった/);
  assert.equal(r.failed.length, 1);
  assert.equal(r.done, 2);
  assert.equal(r.shots.length, 3);
  // 押さえる位置が右下の端（from: [1, 1]）でも、その要素を押さえて動かせる（PR #95 の ai-review の指摘）
  const corner = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "drag", target: "#board", dx: -0.3, dy: -0.3, from: [1, 1] }, { do: "click", target: "決める" }] }, html, {}, "置く", out.replace("d.mp4", "d2.mp4"));
  assert.deepEqual(corner.failed, []);
  assert.equal(corner.done, 2);
});

test("遊ぶ様子の動画の早送り（#66 の動画で、運営者が早送りで直すと決めた）: 待つ手順に倍速を付けられ、動画の長さは ms÷倍速で見積もる", () => {
  const s = parsePlayScript({
    hook: "h", caption: "c",
    steps: [
      { do: "click", target: "焼く" },
      { do: "wait", ms: 8000, fast: 4 },
      { do: "wait", ms: 99_999, fast: FAST_MAX },
    ],
  })!;
  assert.deepEqual(s.steps, [
    { do: "click", target: "焼く" },
    { do: "wait", ms: 8000, fast: 4 },
    { do: "wait", ms: FAST_WAIT_MAX, fast: FAST_MAX },
  ]);
  // 決めた倍速でないものは、ふつうの待ち（3秒まで）にする
  // 早送りの短い方の下限は、ふつうの待ちと同じ0.3秒（PR #104 の ai-review の指摘）
  const short = parsePlayScript({ hook: "h", caption: "c", steps: [{ do: "click", target: "焼く" }, { do: "wait", ms: 300, fast: 2 }, { do: "wait", ms: 100, fast: 2 }] })!;
  assert.deepEqual(short.steps.slice(1), [{ do: "wait", ms: 300, fast: 2 }, { do: "wait", ms: 300, fast: 2 }]);
  // 時間を書き忘れた早送りは、ふつうの待ちと同じ0.8秒（倍速を付けただけで待つ時間が変わらないように。PR #104 の ai-review の指摘）
  assert.deepEqual(parsePlayScript({ hook: "h", caption: "c", steps: [{ do: "click", target: "焼く" }, { do: "wait", fast: 4 }] })!.steps[1], { do: "wait", ms: 800, fast: 4 });
  const odd = parsePlayScript({ hook: "h", caption: "c", steps: [{ do: "click", target: "焼く" }, { do: "wait", ms: 8000, fast: 1.5 }, { do: "wait", ms: 8000, fast: 99 }] })!;
  assert.deepEqual(odd.steps.slice(1), [{ do: "wait", ms: 3000 }, { do: "wait", ms: 3000 }]);
  // 早送りの待ちは、動画では ms÷倍速の長さ（重いツールでは描き直しの分だけ長くなるので、速いほど大きな余裕を見る）
  assert.equal(fastSlack(4), 1.24);
  assert.ok(Math.abs(playSeconds(s.steps.slice(0, 3)) - (0.7 + 1.2 + 2 * fastSlack(4) + (FAST_WAIT_MAX / FAST_MAX / 1000) * fastSlack(FAST_MAX) + 2.2)) < 1e-9);
  // 早送りなら、ふつうでは15秒に入らない長い待ちも入る
  assert.equal(parsePlayScript({ hook: "h", caption: "c", steps: [{ do: "click", target: "焼く" }, { do: "wait", ms: 12_000, fast: 6 }, { do: "click", target: "返す" }] })!.steps.length, 3);
});

test("遊ぶ様子の動画の早送り: ツールの中では ms の時間が進み、15秒に入らない待ちのあとの操作まで届く。枠の下の端に半分出ている所も、見える所へ動かしてからなぞる（ブラウザと ffmpeg があるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  await browser.close();
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg がありません");
  // 「焼く」から12秒たつと「返す」が押せるようになる（ツールのタイマーとアニメーションの合図で数える）
  const html = `<button id="go">焼く</button><button id="flip" disabled>返す</button><div id="out"></div>
<script>document.getElementById("go").onclick=function(){var t0=performance.now();setTimeout(function(){document.getElementById("flip").disabled=false},12000);
(function f(){document.getElementById("out").textContent=Math.floor((performance.now()-t0)/1000)+"秒";requestAnimationFrame(f)})()};
document.getElementById("flip").onclick=function(){document.getElementById("out").textContent="焼けた"};</script>`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "play-"));
  const r = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "焼く" }, { do: "wait", ms: 12_000, fast: 6 }, { do: "wait", ms: 300, fast: 8 }, { do: "click", target: "返す" }] }, html, {}, "焼く", path.join(dir, "f.mp4"));
  // 録画は15秒を超える手順を切る（failed に残る）ので、切られずに「返す」まで押せたことが、12秒の待ちが早送りで済んだしるし
  assert.deepEqual(r.failed, []);
  assert.equal(r.done, 2);
  // 枠（高さ500）の下の端に、上の少しだけ出ているなぞり面。真ん中を押さえると枠の外になるので、見える所へ動かしてからなぞる
  const pad = `<div style="height:470px">上の部分</div><div id="pad" style="height:200px;background:#eee;touch-action:none"></div><button id="ok" disabled>とじる</button>
<script>var p=document.getElementById("pad");p.addEventListener("pointerdown",function(e){p.setPointerCapture(e.pointerId);p.dataset.on="1"});
p.addEventListener("pointermove",function(){if(p.dataset.on)document.getElementById("ok").disabled=false});p.addEventListener("pointerup",function(){p.dataset.on=""});</script>`;
  const r2 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "drag", target: "#pad", dx: 0.6 }, { do: "click", target: "とじる" }] }, pad, {}, "なぞる", path.join(dir, "p.mp4"));
  assert.deepEqual(r2.failed, []);
  assert.equal(r2.done, 2);
});

test("遊ぶ様子の動画（#66 の動画で運営者が見つけた）: 下の帯のツール名は「―」より前だけにする", () => {
  assert.equal(bandTitle("ひだ包み職人 ― 餃子を包んで、焼いて、羽根を咲かせる"), "ひだ包み職人");
  assert.equal(bandTitle("余白の重心検査"), "余白の重心検査");
  assert.equal(bandTitle("―"), "―");
});

test("遊ぶ様子の動画（#66 の動画で運営者が見つけた）: 文字で探すときは押せる所だけを押し、見つからなければ見えているボタンの名前を添える（ブラウザと ffmpeg があるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  await browser.close();
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) return t.skip("ffmpeg がありません");
  // 上に手順の表示（押せない文字「焼く」）、下にボタン「焼きへ（1個）」。ボタンは JS で作る
  const html = `<div id="steps">包む → <span>焼く</span> → 返す</div><div id="ops"></div><div id="out"></div><div style="cursor:pointer" id="card">カードを引く</div>
<script>var b=document.createElement("button");b.type="button";b.textContent="焼きへ（1個）";b.onclick=function(){document.getElementById("out").textContent="焼いた"};document.getElementById("ops").appendChild(b);
document.getElementById("card").onclick=function(){document.getElementById("out").textContent="引いた"};</script>`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "play-")), "k.mp4");
  const r = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "焼く" }, { do: "click", target: "焼きへ" }, { do: "click", target: "カードを引く" }] }, html, {}, "焼く", out);
  // 押せない文字「焼く」は押したことにせず、見えているボタンの名前を添えて知らせる
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0], /1番目の「焼く」が見つからなかった（見えているボタン: 焼きへ（1個））/);
  // ボタンの文字の一部・指の形のカーソルの所は、今までどおり押せる
  assert.equal(r.done, 2);
  // なぞる手順は、押せる所でない帯の中の文字からでも、今までどおり探せる（PR #106 の ai-review の指摘）
  const strip = `<div id="pad" style="height:120px;background:#eee;touch-action:none;cursor:ew-resize"><p>右へなぞる</p></div><button id="ok" disabled>とじる</button>
<script>var p=document.getElementById("pad");p.addEventListener("pointerdown",function(e){p.setPointerCapture(e.pointerId);p.dataset.on="1"});
p.addEventListener("pointermove",function(){if(p.dataset.on)document.getElementById("ok").disabled=false});p.addEventListener("pointerup",function(){p.dataset.on=""});</script>`;
  const r2 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "drag", target: "右へなぞる", dx: 0.5 }, { do: "click", target: "とじる" }] }, strip, {}, "なぞる", out.replace("k.mp4", "k2.mp4"));
  assert.deepEqual(r2.failed, []);
  assert.equal(r2.done, 2);
  // 入力欄の形のボタン・画像だけのボタンの名前も添える。なぞる所が見つからないときは添えない（PR #106 の ai-review の指摘）
  const forms = `<input type="button" value="はじめる"><button><img alt="もう一度" src="data:image/gif;base64,R0lGODlhAQABAAAAACw="  width="20" height="20"></button><button aria-label="閉じる">×</button><span id="lb">設定</span><button aria-labelledby="lb">⚙</button><div role="menuitem">メニューを開く</div><div id="pad" style="height:80px;background:#eee"></div>`;
  const r3 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "ないボタン" }, { do: "drag", target: "#ないなぞり面", dx: 0.5 }, { do: "click", target: "はじめる" }] }, forms, {}, "形", out.replace("k.mp4", "k3.mp4"));
  // 名前は正式な名前（aria-labelledby・aria-label）を表の文字より先に使う（PR #106 の ai-review の指摘）
  assert.equal(r3.failed[0], "1番目の「ないボタン」が見つからなかった（見えているボタン: はじめる・もう一度・閉じる・設定）");
  // 同じ文字の押せない見出しが10個より多くても、そのあとの押せる所を見落とさない（PR #106 の ai-review の指摘）
  const many = `${"<p>次へ進む</p>".repeat(12)}<div id="n" style="cursor:pointer">次へ進む</div><div id="o"></div><script>document.getElementById("n").onclick=function(){document.getElementById("o").textContent="進んだ"};</script>`;
  const r6 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "次へ進む" }] }, many, {}, "多い", out.replace("k.mp4", "k6.mp4"));
  assert.deepEqual(r6.failed, []);
  assert.equal(r6.done, 1);
  // JS で onclick を付けた div（指の形のカーソルなし）の中の文字も押せる（PR #106 の ai-review の指摘）
  const jsClick = `<div id="c"><span>カードを開く</span></div><div id="o"></div><script>document.getElementById("c").onclick=function(){document.getElementById("o").textContent="開いた"};</script>`;
  const r5 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "カードを開く" }] }, jsClick, {}, "JS", out.replace("k.mp4", "k5.mp4"));
  assert.deepEqual(r5.failed, []);
  assert.equal(r5.done, 1);
  // 押せる役の印（menuitem）の要素は、指の形のカーソルでなくても、文字で押せる（PR #106 の ai-review の指摘）
  const r4 = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "メニューを開く" }] }, forms, {}, "形", out.replace("k.mp4", "k4.mp4"));
  assert.deepEqual(r4.failed, []);
  assert.equal(r4.done, 1);
  assert.equal(r3.failed[1], "2番目の「#ないなぞり面」が見つからなかった");
});

test("遊ぶ様子の動画（#66 の動画で運営者が見つけた）: 確かめ用のコマでは、押す所を示す赤い丸を消して撮る（ブラウザと ffmpeg があるときだけ）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  if (spawnSync("ffmpeg", ["-version"]).status !== 0) { await browser.close(); return t.skip("ffmpeg がありません"); }
  // 枠いっぱいの青いボタン。押したあとの途中のコマで、ボタンの真ん中（赤い丸が残っている所）の色を見る
  const html = `<style>html,body{margin:0}</style><button id="b" style="position:absolute;left:0;top:0;width:360px;height:200px;border:0;background:#0000ff">押す</button>`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "play-")), "f.mp4");
  const r = await renderPlay({ hook: "x", caption: "c", steps: [{ do: "click", target: "押す" }, { do: "wait", ms: 300 }] }, html, {}, "丸", out);
  assert.equal(r.done, 1);
  const page = await browser.newPage();
  const at = async (shot: Buffer, x: number, y: number) => page.evaluate(async ({ src, x, y }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const g = c.getContext("2d")!;
    g.drawImage(img, 0, 0);
    return Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, { src: `data:image/jpeg;base64,${shot.toString("base64")}`, x, y });
  // ボタンの真ん中は、枠の上端（270px）＋ ボタンの高さの半分（100px）× 3倍
  const [red, , blue] = await at(r.shots[1], 540, 270 + 300);
  await browser.close();
  assert.ok(red < 80 && blue > 180, `途中のコマのボタンの真ん中の色 ${red},${blue}（赤い丸が残っていない青のはず）`);
});
