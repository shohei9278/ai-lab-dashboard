import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { launch } from "../src/lib/freePage";
import { IN_APP_SCRIPT, PLAY_MIN_HEIGHT, fitScale, inAppOf, rememberedInApp, toolFluid } from "../lp-site/src/lp/inApp";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 運営者が #72 を X から開いたら、いちばん下の「ふる」がアプリの帯に隠れ、結果のあとの欄も遊びの途中で開いて操作を隠した。
// 確かめ用ページで測って、遊ぶ画面は画面に固定し、X のときだけ上を空け、低い画面では縮めて収める作りにした（運営者が決めた）

const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// 運営者が /inapp-check を開いた実機の名乗り
const X_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22H352 Twitter for iPhone/12.17";
const LINE_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/26.16.0";
const IG_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22H352 Instagram 455.0.0.35.67 (iPhone15,3; iOS 18_7_8; ja_JP; ja; scale=3.00; 1290x2796; IABMV/1; 1109782713) Safari/604.1";
test("アプリの中のブラウザ: どのアプリかを見分ける（X・Instagram・LINE と、そのほかのアプリの中）。普通のブラウザは見分けない", () => {
  assert.equal(inAppOf(X_IPHONE, "https://t.co/", true), "x");
  assert.equal(inAppOf(LINE_IPHONE, "", true), "line");
  assert.equal(inAppOf(IG_IPHONE, "https://l.instagram.com/", true), "instagram");
  assert.equal(inAppOf("Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36 TwitterAndroid", "", true), "x");
  assert.equal(inAppOf(SAFARI.replace("Safari/604.1", "[FBAN/FBIOS;FBAV/450.0]"), "", true), "other");
  assert.equal(inAppOf(SAFARI, "https://t.co/abc", true), "x"); // 念のための見分け方（X の短縮リンクから来たスマホ）
  // アプリの中のブラウザの作りで見分ける（名乗りにアプリの印がないもの）
  assert.equal(inAppOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354", "", true), "other");
  assert.equal(inAppOf("Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0 Mobile Safari/537.36", "", true), "other");
  // 普通のブラウザ（iPhone の Safari・Chrome・Firefox、Android の Chrome）は、アプリの中ではない
  assert.equal(inAppOf(SAFARI, "", true), null);
  assert.equal(inAppOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1", "", true), null);
  assert.equal(inAppOf("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15", "", true), null);
  assert.equal(inAppOf("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36", "", true), null);
  assert.equal(inAppOf(SAFARI, "https://t.co/abc", false), null); // PC で X から来た人は、普通のブラウザ
  assert.equal(inAppOf(SAFARI, "https://www.google.com/", true), null);
  assert.equal(inAppOf(SAFARI, "not a url", true), null);
});

test("アプリの中のブラウザ: 先頭で動かす文が <html data-inapp=\"アプリ\"> を付け、同じタブの別のページでも続ける", () => {
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
    if (attrs.has("data-inapp")) assert.equal(attrs.get("data-inapp-src"), "script"); // どこで付いたかを、確かめ用ページに出す
    return attrs.get("data-inapp") ?? null;
  };
  const store = new Map<string, string>();
  assert.equal(run(SAFARI, "https://t.co/abc", store), "x");
  assert.equal(run(SAFARI, "", store), "x"); // サイトの中で移ったあと
  assert.equal(run(SAFARI, "", new Map()), null);
  assert.equal(run(SAFARI, "", new Map([["lab-inapp", "bogus"]])), null); // 覚えた値が決まった種類でなければ使わない
  // 保存領域が使えないブラウザでも、名乗りで見分けて印を付ける（PR #113 の ai-review の指摘）
  assert.equal(run(LINE_IPHONE, "", "broken"), "line");
  assert.equal(run(SAFARI, "", "broken"), null);
  // 読み込んだあとに付け直すとき（InAppMark）も、覚えた値は決まった種類のときだけ使う
  assert.equal(rememberedInApp("x"), "x");
  assert.equal(rememberedInApp("1"), null); // 前の作りが覚えていた値
  assert.equal(rememberedInApp(null), null);
});

test("遊ぶ画面（運営者が決めた）: 見えている高さが決まった高さより低いときだけ、ツールをその高さで作らせて縮める。自分で合わせるツールは印で分かる", () => {
  assert.deepEqual(fitScale(430, 734), { scale: 1, width: 430, height: 734 }); // X で投稿を閉じたとき（798 − 上の 64）
  const low = fitScale(430, 320, 640);
  assert.equal(low.scale, 0.5);
  assert.deepEqual([low.width, low.height], [860, 640]); // 幅も同じ割合で広げて作らせ、横は枠いっぱいのまま
  assert.deepEqual(fitScale(0, 0), { scale: 1, width: 0, height: 0 }); // 測る前は縮めない
  assert.equal(PLAY_MIN_HEIGHT, 640);
  assert.equal(toolFluid('<meta name="lab-fluid" content="1"><div></div>'), true);
  assert.equal(toolFluid("<div>lab-fluid</div>"), false);
  // 属性の順番・空白・引用符が違っても同じ意味なら見分ける（PR #118 の ai-review の指摘）
  assert.equal(toolFluid('<meta content="1" name="lab-fluid">'), true);
  assert.equal(toolFluid("<meta name = 'lab-fluid' >"), true);
  assert.equal(toolFluid("<META NAME=lab-fluid>"), true);
  assert.equal(toolFluid('<meta name="lab-fluid-x">'), false);
  assert.equal(toolFluid('<meta data-name="lab-fluid">'), false);
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
