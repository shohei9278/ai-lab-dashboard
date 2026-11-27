import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 「使った」の数え方（lp-site/src/lp/toolHtml.ts の BRIDGE）
// 描く・なぞるツールは、押したまま動かすのでクリックが起きない。描く枠（canvas）や、なぞる操作を受ける所（touch-action: none）で指を置いたときも数える
// （#73「まる一筆鑑定所」で、丸を描いても「使った」が0のままだった。運営者が見つけた）

async function uses(body: string, act: (page: import("playwright-core").Page) => Promise<void>): Promise<number | string> {
  const browser = await launch();
  if (typeof browser === "string") return browser;
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe id="f" sandbox="allow-scripts" style="width:300px;height:200px;border:0"></iframe><script>
      window.got = 0;
      addEventListener("message", function (e) { if (e.data && e.data.__lab === "use") window.got++; });
    </script>`);
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(body));
    await page.waitForTimeout(300);
    await act(page);
    await page.waitForTimeout(150);
    return (await page.evaluate("window.got")) as number;
  } finally {
    await browser.close();
  }
}

// 指でなぞる操作（タッチ）は、押して動かして離しても click が起きない。それを、枠の中で pointer のイベントだけを出してまねる
// （tsx が関数に足す補助の名前が枠の中にないので、文字のスクリプトで渡す）
const drag = (selector: string, button = 0) => async (page: import("playwright-core").Page) => {
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await frame.evaluate(`(function () {
    var el = document.querySelector(${JSON.stringify(selector)});
    function ev(type, x) { el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: ${button === 0 ? '"touch"' : '"mouse"'}, button: ${button}, pointerId: 1, clientX: x, clientY: 60, buttons: type === "pointerup" ? 0 : 1 })); }
    ev("pointerdown", 60);
    for (var i = 1; i < 10; i++) ev("pointermove", 60 + i * 10);
    ev("pointerup", 150);
  })()`);
};

test("使った: 描く枠（canvas）の上で押したまま動かすと、クリックが起きなくても数える（1回だけ）", async (t) => {
  // 描く処理が pointerdown で preventDefault し、指を枠に固定する作り（#73 と同じ）
  const n = await uses(`<canvas id="c" width="280" height="180" style="display:block"></canvas><script>
    c.addEventListener("pointerdown", function (e) { e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch (_) {} });
  </script>`, async (page) => { await drag("#c")(page); await drag("#c")(page); });
  if (typeof n === "string") return t.skip(n);
  assert.equal(n, 1);
});

test("使った: なぞる操作を受ける所（touch-action: none）で押したまま動かすと数える", async (t) => {
  const n = await uses(`<div id="d" style="touch-action:none;width:280px;height:180px">なぞる</div>`, drag("#d"));
  if (typeof n === "string") return t.skip(n);
  assert.equal(n, 1);
});

test("使った: ただの文章の上で押して動かしただけ（文字を選ぶなど）では数えない", async (t) => {
  const n = await uses(`<p id="p" style="width:280px;height:180px">説明の文章</p>`, drag("#p"));
  if (typeof n === "string") return t.skip(n);
  assert.equal(n, 0);
});

test("使った: なぞる操作を受ける所の中の子要素（文字や絵）から描き始めても数える（PR #214 の ai-review の指摘）", async (t) => {
  const n = await uses(`<div style="touch-action:none;width:280px;height:180px"><span id="s">ここをなぞる</span><svg width="40" height="40"><circle id="c" cx="20" cy="20" r="10"/></svg></div>`, async (page) => { await drag("#s")(page); await drag("#c")(page); });
  if (typeof n === "string") return t.skip(n);
  assert.equal(n, 1);
});

test("使った: 描く枠の上でも、右クリック・中クリックでは数えない（PR #214 の ai-review の指摘）", async (t) => {
  const n = await uses(`<canvas id="c" width="280" height="180" style="display:block"></canvas>`, async (page) => { await drag("#c", 2)(page); await drag("#c", 1)(page); });
  if (typeof n === "string") return t.skip(n);
  assert.equal(n, 0);
});
