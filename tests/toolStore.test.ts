import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { TOOL_STORE_MAX, answerStore, memoryBackend, storeKey } from "../lp-site/src/lp/toolStore";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 運営者の依頼（#72）: ツールの記録を、ページの側に預ける窓口（window.labStore）。localStorage を枠に許すのではなく、ページがツールごとの場所に残す

test("記録の窓口: ページの側は、読み・残すの知らせだけに答え、JSON で決まった大きさまでの値だけを残す", () => {
  const b = memoryBackend(), k = storeKey("p72");
  assert.equal(k, "lab-store:p72");
  assert.equal(answerStore({ __lab: "height", h: 100 }, k, b), null);
  assert.equal(answerStore(null, k, b), null);
  assert.deepEqual(answerStore({ __lab: "store-get", id: 1 }, k, b), { __lab: "store", id: 1, ok: true, value: null });
  assert.deepEqual(answerStore({ __lab: "store-set", id: 2, value: '{"seen":[1,0]}' }, k, b), { __lab: "store", id: 2, ok: true });
  assert.deepEqual(answerStore({ __lab: "store-get", id: 3 }, k, b), { __lab: "store", id: 3, ok: true, value: '{"seen":[1,0]}' });
  // JSON でない・大きすぎる・文字でない値は残さない（前の値のまま）
  for (const value of ["{", "x".repeat(TOOL_STORE_MAX + 1), 3]) assert.equal(answerStore({ __lab: "store-set", id: 4, value }, k, b)!.ok, false);
  assert.equal(b.get(k), '{"seen":[1,0]}');
  // 場所はページが決める（ほかのツールの記録は読めない）
  assert.equal(answerStore({ __lab: "store-get", id: 5 }, storeKey("p73"), b)!.value, null);
});

test("記録の窓口: 枠の中の window.labStore が、ページとやりとりして値を残し、読み戻せる。ページが答えないときは null・false", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage();
    const tool = `<script>
      window.run = async function () {
        var first = await window.labStore.get();
        var ok = await window.labStore.set({ seen: [1, 0, 1], at: "0:12" });
        var tooBig = await window.labStore.set({ s: "${"x".repeat(TOOL_STORE_MAX)}" });
        var back = await window.labStore.get();
        parent.postMessage({ result: { first: first, ok: ok, tooBig: tooBig, back: back } }, "*");
      };
    </script>`;
    // ページの側（ToolFrame と同じ答え方を、テストの中で再現する）
    await page.setContent(`<iframe id="f" sandbox="allow-scripts"></iframe><script>
      var mem = {};
      addEventListener("message", function (e) {
        var d = e.data, f = document.getElementById("f").contentWindow;
        if (e.source !== f || !d) return;
        if (d.result) { window.__result = d.result; return; }
        if (d.__lab === "store-get") f.postMessage({ __lab: "store", id: d.id, ok: true, value: mem.v || null }, "*");
        if (d.__lab === "store-set") { if (d.value.length <= ${TOOL_STORE_MAX}) mem.v = d.value; f.postMessage({ __lab: "store", id: d.id, ok: d.value.length <= ${TOOL_STORE_MAX} }, "*"); }
      });
    </script>`);
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(tool));
    await page.waitForTimeout(300);
    await page.frames()[1].evaluate("window.run()");
    await page.waitForFunction("!!window.__result", null, { timeout: 5000 });
    assert.deepEqual(await page.evaluate("window.__result"), { first: null, ok: true, tooBig: false, back: { seen: [1, 0, 1], at: "0:12" } });
    // ページが答えないとき（公開前の自動テスト・動画の録画）は、待ちすぎずに null・false
    const alone = await browser.newPage();
    await alone.setContent('<iframe id="f" sandbox="allow-scripts"></iframe><script>addEventListener("message", function (e) { if (e.data && e.data.result) window.__result = e.data.result; });</script>');
    await alone.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(tool));
    await alone.waitForTimeout(300);
    await alone.frames()[1].evaluate("window.run()");
    await alone.waitForFunction("!!window.__result", null, { timeout: 8000 });
    assert.deepEqual(await alone.evaluate("window.__result"), { first: null, ok: false, tooBig: false, back: null });
  } finally {
    await browser.close();
  }
});

test("枠: スマホの動きのセンサーの知らせが、枠の中にも届くように許す", async () => {
  const src = (await import("node:fs")).readFileSync("lp-site/src/lp/ToolFrame.tsx", "utf8");
  assert.match(src, /allow="clipboard-write; accelerometer; gyroscope"/);
  assert.match(src, /sandbox="allow-scripts allow-downloads"/);
});
