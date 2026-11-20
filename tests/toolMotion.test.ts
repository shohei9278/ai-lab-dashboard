import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { motionMessage, motionPath, motionStateOf } from "../lp-site/src/lp/toolMotion";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 運営者の依頼（#72）: iPhone でも振って遊べるよう、動きのセンサーの許可はページの側で求め、枠の中のツールに動きを渡す（window.labMotion）

test("動きの窓口: 端末ごとに許可の取り方を分け、動きの知らせは値のあるものだけを渡す", () => {
  assert.equal(motionPath(undefined), "none");
  assert.equal(motionPath({}), "direct"); // Android など: 許可が要らない
  assert.equal(motionPath({ requestPermission: async () => "granted" }), "ask"); // iPhone など
  assert.equal(motionStateOf("granted"), "granted");
  assert.equal(motionStateOf("denied"), "denied");
  assert.equal(motionStateOf(undefined), "denied");
  assert.deepEqual(motionMessage({ x: 1.234, y: -9.81, z: null }), { __lab: "motion", x: 1.23, y: -9.81, z: 0 });
  assert.equal(motionMessage({ x: null, y: null, z: null }), null);
  assert.equal(motionMessage(null), null);
});

test("動きの窓口: 枠の中の window.labMotion が許可を頼み、ページから渡された動きを labmotion イベントで受け取る。ページが答えないときは unavailable", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const tool = `<script>
      window.got = [];
      addEventListener("labmotion", function (e) { window.got.push(e.detail); });
      window.run = async function () { var s = await window.labMotion.request(); parent.postMessage({ result: s }, "*"); };
    </script>`;
    const page = await browser.newPage();
    // ページの側（ToolFrame と同じ答え方を、テストの中で再現する。許可したら動きを2回渡す）
    await page.setContent(`<iframe id="f" sandbox="allow-scripts"></iframe><script>
      addEventListener("message", function (e) {
        var d = e.data, f = document.getElementById("f").contentWindow;
        if (e.source !== f || !d) return;
        if (d.result) { window.__result = d.result; return; }
        if (d.__lab === "motion-request") {
          f.postMessage({ __lab: "motion-state", id: d.id, state: "granted" }, "*");
          f.postMessage({ __lab: "motion", x: 1, y: -9.8, z: 0.5 }, "*");
          f.postMessage({ __lab: "motion", x: 12, y: 3, z: 0 }, "*");
        }
      });
    </script>`);
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(tool));
    await page.waitForTimeout(300);
    await page.frames()[1].evaluate("window.run()");
    await page.waitForFunction("!!window.__result", null, { timeout: 5000 });
    assert.equal(await page.evaluate("window.__result"), "granted");
    await page.waitForTimeout(200);
    assert.deepEqual(await page.frames()[1].evaluate("window.got"), [{ x: 1, y: -9.8, z: 0.5 }, { x: 12, y: 3, z: 0 }]);
    // 枠の外に出ていない（公開前の自動テスト）ときは、すぐ unavailable
    const alone = await browser.newPage();
    await alone.setContent(wrapToolHtml(tool));
    assert.equal(await alone.evaluate("window.labMotion.request()"), "unavailable");
  } finally {
    await browser.close();
  }
});
