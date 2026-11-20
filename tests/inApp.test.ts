import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { launch } from "../src/lib/freePage";
import { IN_APP_SCRIPT, inAppOf } from "../lp-site/src/lp/inApp";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 運営者が #72 を X から開いたら、いちばん下の「ふる」がアプリの帯に隠れ、結果のあとの欄も遊びの途中で開いて操作を隠した

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
test("アプリの中のブラウザ: SNS のアプリの名乗りか、スマホで X の短縮リンクから来たときだけ見分ける", () => {
  assert.equal(inAppOf(SAFARI + " Instagram 300.0", "", true), true);
  assert.equal(inAppOf(SAFARI.replace("Safari/604.1", "[FBAN/FBIOS;FBAV/450.0]"), "", true), true);
  assert.equal(inAppOf(SAFARI + " Line/14.0.0", "", true), true);
  assert.equal(inAppOf("Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36 TwitterAndroid", "", true), true);
  // アプリの中のブラウザの作りで見分ける（X の iPhone のアプリは、名乗りにアプリの印がない）
  assert.equal(inAppOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354", "", true), true);
  assert.equal(inAppOf("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36", "", true), true);
  // 普通のブラウザ（iPhone の Chrome・Firefox、Android の Chrome）は、アプリの中ではない
  assert.equal(inAppOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1", "", true), false);
  assert.equal(inAppOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15", "", true), false);
  assert.equal(inAppOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36", "", true), false);
  assert.equal(inAppOf(SAFARI, "https://t.co/abc", true), true); // 念のための見分け方（X の短縮リンクから来たスマホ）
  assert.equal(inAppOf(SAFARI, "https://t.co/abc", false), false); // PC で X から来た人は、普通のブラウザ
  assert.equal(inAppOf(SAFARI, "https://www.google.com/", true), false);
  assert.equal(inAppOf(SAFARI, "", true), false);
  assert.equal(inAppOf(SAFARI, "not a url", true), false);
});

test("アプリの中のブラウザ: 先頭で動かす文が <html data-inapp> を付け、同じタブの別のページでも続ける", () => {
  const run = (ua: string, referrer: string, store: Map<string, string> | "broken") => {
    const attrs = new Map<string, string>();
    const fail = () => { throw new Error("SecurityError"); };
    const ctx: Record<string, unknown> = {
      navigator: { userAgent: ua },
      document: { referrer, documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } },
      matchMedia: () => ({ matches: true }),
      sessionStorage: store === "broken" ? { getItem: fail, setItem: fail } : { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
      URL,
    };
    ctx.window = ctx;
    vm.runInNewContext(IN_APP_SCRIPT, ctx);
    return attrs.has("data-inapp");
  };
  const store = new Map<string, string>();
  assert.equal(run(SAFARI, "https://t.co/abc", store), true);
  // 保存領域が使えないブラウザでも、名乗りで見分けて印を付ける（PR #113 の ai-review の指摘）
  assert.equal(run(SAFARI + " Instagram 300.0", "", "broken"), true);
  assert.equal(run(SAFARI, "", "broken"), false);
  assert.equal(run(SAFARI, "", store), true); // サイトの中で移ったあと
  assert.equal(run(SAFARI, "", new Map()), false);
});

test("結果の知らせ: quiet を付けると、ページへの知らせに quiet が付く（結果のあとの欄を開かせない）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe id="f" sandbox="allow-scripts"></iframe><script>
      window.got = [];
      addEventListener("message", function (e) { if (e.data && (e.data.__lab === "share-text" || e.data.__lab === "result")) window.got.push(e.data); });
    </script>`);
    const tool = `<script>window.run = function () { labShare("一文A"); labShare("一文B", { quiet: true }); labResult(2); labResult(3, { quiet: true }); };</script>`;
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml(tool));
    await page.waitForTimeout(300);
    await page.frames()[1].evaluate("window.run()");
    await page.waitForTimeout(200);
    assert.deepEqual(await page.evaluate("window.got"), [
      { __lab: "share-text", text: "一文A", quiet: false },
      { __lab: "share-text", text: "一文B", quiet: true },
      { __lab: "result", i: 2, quiet: false },
      { __lab: "result", i: 3, quiet: true },
    ]);
  } finally {
    await browser.close();
  }
});
