import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { db } from "../src/lib/db";
import { testIssues, testTool } from "../src/lib/toolTest";
import { checkToolErrors, toolErrors } from "../src/lib/funnel";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";
import { parseToolError, toolErrorDetail } from "../lp-site/src/lp/toolErrors";

// 運営者が実機で見つけた不具合（#72 で強く振っても雪がほとんど舞わない・X の中で下の操作が隠れる）を、公開前の自動テストで見つけられるようにした
// 本番で来た人の画面でツールが止まっても誰も気づけなかったので、ツールの中のエラーを集めて案件の画面と通知に出す（運営者が「1と2で」と決めた）

// 振ると大きな四角を描くツール（weak: 1つ前の値との差で測るので、強く振ってもほとんど反応しない）
const motionTool = (weak: boolean) => `<div id="v" style="width:300px;height:300px;background:#000"></div>
<button type="button" id="s">センサーで振る</button><button type="button" id="o">おしまい</button>
<script>
var last = null, g = null, n = 0;
document.getElementById("o").onclick = function () { document.getElementById("v").dataset.end = "1"; };
document.getElementById("s").onclick = function () {
  window.labMotion.request().then(function (st) {
    if (st !== "granted") return;
    addEventListener("labmotion", function (e) {
      var d = e.detail, m;
      ${weak
        ? "if (last) { m = Math.hypot(d.x - last.x, d.y - last.y); if (m > 10) n++; } last = d;"
        : "if (!g) g = { x: d.x, y: d.y }; g.x += (d.x - g.x) * 0.05; g.y += (d.y - g.y) * 0.05; m = Math.hypot(d.x - g.x, d.y - g.y); if (m > 5) n++;"}
      document.getElementById("v").style.background = n ? "hsl(" + (n * 37 % 360) + ",90%,60%)" : "#000";
    });
  });
};
</script>`;

test("公開前の自動テスト: 振って遊ぶツールは、振る動きを流して画面が変わるかを見る（弱い測り方を見つける）", async (t) => {
  const good = await testTool(motionTool(false), "test-motion-good");
  if (good.skipped) return t.skip(good.skipped);
  assert.equal(good.motion?.ok, true, JSON.stringify(good.motion));
  const weak = await testTool(motionTool(true), "test-motion-weak");
  assert.equal(weak.motion?.ok, false, JSON.stringify(weak.motion));
  assert.equal(weak.ok, false);
  assert.ok(testIssues(weak).some((x) => /振る動き/.test(x) && /重力をならした/.test(x)));
  // 「次へ」を何回か押してからセンサーに進むツールでも、センサーまで進んで確かめる（同じ名前のボタンも、画面が変わればまた押す。PR #125 の ai-review の指摘）
  const steps = `<div id="a">はじめ<button type="button" onclick="a.hidden=true;b.hidden=false">次へ</button></div>
<div id="b" hidden>つぎ<button type="button" onclick="b.hidden=true;c.hidden=false">次へ</button></div>
<div id="c" hidden>${motionTool(true)}</div>`;
  const stepped = await testTool(steps, "test-motion-steps");
  assert.equal(stepped.motion?.ok, false, JSON.stringify(stepped.motion));
  // 動きのセンサーを使わないツールは、振りを確かめない
  const plain = await testTool(`<button type="button" onclick="this.textContent='押した'">押す</button>`, "test-motion-none");
  assert.equal(plain.motion, undefined);
});

test("公開前の自動テスト: 遊びの短いページのツールは、640px の画面で押す所が画面の下に出ていないかを見る", async (t) => {
  const tall = `<div style="height:900px">絵</div><button type="button" onclick="this.textContent='押した'">ふる</button>`;
  const r = await testTool(tall, "test-tall-short", { short: true });
  if (r.skipped) return t.skip(r.skipped);
  assert.deepEqual(r.offscreen, ["ふる"]);
  assert.equal(r.ok, false);
  assert.ok(testIssues(r).some((x) => /640px/.test(x) && /「ふる」/.test(x)));
  // 入力欄なども、押す所と同じく見る（PR #125 の ai-review の指摘）
  const input = await testTool(`<div style="height:900px">絵</div><input placeholder="答え"><button type="button" onclick="this.textContent='押した'">決める</button>`, "test-tall-input", { short: true });
  assert.deepEqual(input.offscreen, ["答え", "決める"]);
  // 紹介ページのあるツール（枠が中身の高さに伸びる）では見ない
  const long = await testTool(tall, "test-tall-long");
  assert.equal(long.offscreen, undefined);
  // 画面に収まっているもの・スクロールできる一覧の中のものは数えない
  const fit = await testTool(`<div style="height:300px">絵</div><div style="height:200px;overflow:auto"><div style="height:600px"></div><button type="button">一覧の下</button></div><button type="button" onclick="this.textContent='押した'">ふる</button>`, "test-fit-short", { short: true });
  assert.deepEqual(fit.offscreen, []);
});

test("本番のエラー: ツールの中で起きたエラーの種類と行の番号を、読み込み中のものも含めて3つまで知らせる", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe id="f" sandbox="allow-scripts"></iframe><script>
      window.got = [];
      addEventListener("message", function (e) { if (e.data && e.data.__lab === "error") window.got.push(e.data); });
    </script>`);
    const tool = `<p>遊び</p>
<script>
null.x;
</script>
<script>window.run = function () { setTimeout(function () { undefined.y; }); setTimeout(function () { undefined.y; }); Promise.reject(new RangeError("r")); setTimeout(function () { throw new SyntaxError("s"); }); setTimeout(function () { throw new EvalError("e"); }); };</script>`;
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(tool));
    await page.waitForTimeout(300);
    assert.deepEqual(await page.evaluate("window.got"), [{ __lab: "error", name: "TypeError", line: 3 }]); // 読み込み中のエラーも、ツールのコードの行の番号で
    await page.frames()[1].evaluate("window.run()");
    await page.waitForTimeout(300);
    const got = (await page.evaluate("window.got")) as { name: string; line: number }[];
    assert.equal(got.length, 3); // 同じものは1回、全部で3つまで
    assert.deepEqual(got.map((x) => x.name).slice(0, 2), ["TypeError", "TypeError"]);
  } finally {
    await browser.close();
  }
});

test("本番のエラー: 記録の形を確かめ、案件ごとにまとめ、増えたときだけ経過に残して知らせる", () => {
  assert.equal(toolErrorDetail("TypeError", 12), "TypeError.L12");
  assert.equal(toolErrorDetail("Type Error!", 0), "TypeError.L0");
  assert.equal(toolErrorDetail("", 3), null);
  assert.deepEqual(parseToolError("TypeError.L12"), { name: "TypeError", line: 12 });
  assert.deepEqual(parseToolError("Rejection.L0"), { name: "Rejection", line: null });
  assert.equal(parseToolError("TypeError.L12;drop"), null);
  assert.deepEqual(toolErrors([
    { name: "tool_error", detail: "TypeError.L12", visitors: 2 }, { name: "tool_error", detail: "TypeError.L12", visitors: 1 },
    { name: "tool_error", detail: "bad", visitors: 9 }, { name: "tool_error", detail: "RangeError.L3", visitors: 1 }, { name: "play_time", detail: "15", visitors: 4 },
  ]), [{ name: "TypeError", line: 12, visitors: 3 }, { name: "RangeError", line: 3, visitors: 1 }]);

  const conn = db();
  const id = Number(conn.prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, lp_version, public_version) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 2, 2)").run().lastInsertRowid);
  const p = () => conn.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Parameters<typeof checkToolErrors>[0];
  const logged = () => (conn.prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'tool-runtime-error' ORDER BY id").all(id) as { message: string }[]).map((r) => r.message);
  const add = (v: number, detail: string, n: number) => conn.prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, ?, 'tool_error', ?, ?)").run(id, v, detail, n);
  checkToolErrors(p());
  assert.deepEqual(logged(), []);
  add(2, "TypeError.L12", 2);
  checkToolErrors(p());
  checkToolErrors(p()); // 増えていなければ知らせない
  assert.equal(logged().length, 1);
  assert.match(logged()[0], /第2版.*のべ2人.*TypeError（12行目） 2人/);
  add(2, "RangeError.L3", 1);
  checkToolErrors(p());
  assert.equal(logged().length, 2);
  add(1, "TypeError.L5", 9); // 公開中でない版は見ない
  checkToolErrors(p());
  assert.equal(logged().length, 2);
});
