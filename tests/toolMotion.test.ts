import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { motionGate, motionMessage, motionPath, motionStateOf, type MotionState } from "../lp-site/src/lp/toolMotion";
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

// ページの側の窓口を、端末の代わりの作り物で動かす（fire: 動きの知らせを1回送る）
function fakeGate(api: { requestPermission?: () => Promise<string> } | undefined) {
  const replies: [number, MotionState][] = [], sent: unknown[] = [], button: boolean[] = [];
  let on: ((a: { x: number | null; y: number | null; z: number | null }) => void) | null = null;
  const g = motionGate({
    api: () => api,
    listen: (f) => { on = f; return () => { on = null; }; },
    send: (m) => sent.push(m),
    reply: (id, s) => replies.push([id, s]),
    showButton: (b) => button.push(b),
    wait: 40,
  });
  return { g, replies, sent, button, fire: (x: number | null) => on?.({ x, y: x === null ? null : -9.8, z: 0 }), listening: () => !!on };
}
const tick = (ms = 0) => new Promise((ok) => setTimeout(ok, ms));

// ai-review の指摘（#112）: センサーの仕組みだけある端末で granted を返さない・続けて頼まれても全部に答える
test("動きの窓口: 許可が要らない端末は、動きの知らせが届いてから granted。続けて頼まれても、待っている頼みすべてに答え、次からはすぐ答える", async () => {
  const f = fakeGate({});
  f.g.request(1); f.g.request(2);
  await tick();
  assert.deepEqual(f.replies, []); // まだ知らせが届いていない
  f.fire(null); // 値のない知らせ（PC の Chrome などが出す）は数えない
  f.fire(1.5);
  assert.deepEqual(f.replies, [[1, "granted"], [2, "granted"]]);
  assert.deepEqual(f.sent, [{ __lab: "motion", x: 1.5, y: -9.8, z: 0 }]);
  f.g.request(3);
  assert.deepEqual(f.replies.at(-1), [3, "granted"]);
});

test("動きの窓口: 仕組みはあっても知らせが届かない端末（センサーのない PC）は unavailable にして聞くのをやめ、次からもすぐ unavailable", async () => {
  const f = fakeGate({});
  f.g.request(1); f.g.request(2);
  f.fire(null);
  await tick(80);
  assert.deepEqual(f.replies, [[1, "unavailable"], [2, "unavailable"]]);
  assert.equal(f.listening(), false);
  f.g.request(3);
  assert.deepEqual(f.replies.at(-1), [3, "unavailable"]);
  const none = fakeGate(undefined);
  none.g.request(7);
  assert.deepEqual(none.replies, [[7, "unavailable"]]);
});

test("動きの窓口: 許可が要る端末は、求めるのを1回にし、断られたらボタンを出す。タップで許可されたら、待っている頼みすべてに granted", async () => {
  let asked = 0, tapped = false;
  const f = fakeGate({ requestPermission: async () => { asked++; if (!tapped) throw new Error("NotAllowedError"); return "granted"; } });
  f.g.request(1); f.g.request(2);
  await tick();
  assert.equal(asked, 1);
  assert.deepEqual(f.button, [true]);
  tapped = true;
  await f.g.tap();
  f.fire(0.3);
  assert.deepEqual(f.replies, [[1, "granted"], [2, "granted"]]);
  assert.equal(f.button.at(-1), false);
});

test("動きの窓口: 「使わない」は待っている頼みすべてに denied を返し、覚えない（頼み直せば、またボタンを出す）", async () => {
  const f = fakeGate({ requestPermission: async () => "denied" });
  f.g.request(1); f.g.request(2);
  await tick();
  f.g.decline();
  assert.deepEqual(f.replies, [[1, "denied"], [2, "denied"]]);
  f.g.request(3);
  await tick();
  assert.equal(f.button.at(-1), true);
  assert.equal(f.replies.length, 2);
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
