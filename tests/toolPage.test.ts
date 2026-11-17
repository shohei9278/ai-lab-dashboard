import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { TOOL_SLOT, wrapPageHtml } from "../lp-site/src/lp/pageHtml";
import { fillToolSlot, splitToolPage } from "../lp-site/src/lp/htmlDom";
import { launch, staticPageIssues } from "../src/lib/freePage";

const page = (body: string, head = '<style>body{color:red}</style>') => `<!doctype html><html lang="ja"><head><title>t</title>${head}</head><body class="x">${body}</body></html>`;

test("ツールのページ: ツールを入れる場所の前後で、同じ head を持つ2つのページに分ける", () => {
  const parts = splitToolPage(page(`<header><h1>名前</h1></header>${TOOL_SLOT}<section>説明</section><footer><span data-lab="operator"></span></footer>`))!;
  assert.ok(parts.top.includes("<h1>名前</h1>") && !parts.top.includes("説明"));
  assert.ok(parts.bottom.includes("<section>説明</section>") && !parts.bottom.includes("<h1>"));
  for (const d of [parts.top, parts.bottom]) {
    assert.ok(d.includes("<style>body{color:red}</style>"));
    assert.ok(d.includes('<body class="x">'));
    assert.ok(!d.includes("lab-tool"));
  }
  assert.equal(splitToolPage(page("<h1>名前</h1><section>説明</section>")), null);
  assert.equal(splitToolPage(page(`${TOOL_SLOT}<p>x</p>${TOOL_SLOT}`)), null);
  // ai-review の指摘: 置き場所がほかの要素の中にあるときは分けない（上下でタグが別れて形が崩れる）
  assert.equal(splitToolPage(page(`<section><h1>名前</h1>${TOOL_SLOT}</section><p>説明</p>`)), null);
  // body の直下なら、前に閉じたタグ・中身のない要素・コメント・script があっても分ける
  assert.ok(splitToolPage(page(`<header><h1>名前</h1><img src="x"><br/></header><!-- <div> --><script>if (a<b) {}</script>${TOOL_SLOT}<p>説明</p>`)));
  // ai-review の指摘: 閉じタグの名前が食い違うと、ブラウザは置き場所を section の中に入れるので分けない
  assert.equal(splitToolPage(page(`<section></div>${TOOL_SLOT}</section>`)), null);
  // ブラウザが組み直して body の直下に来るときは、組み直したあとの形で分ける
  assert.ok(splitToolPage(page(`<div><span></div></span>${TOOL_SLOT}<p>説明</p>`))!.top.includes('<body class="x"><div><span></span></div></body>'));
  // ai-review の指摘: 属性の付いたもの・div 以外・引用符なしでも、id が lab-tool の要素が2つ以上なら分けない
  assert.equal(splitToolPage(page(`${TOOL_SLOT}<span id="lab-tool"></span>`)), null);
  assert.equal(splitToolPage(page(`<section id=lab-tool></section>${TOOL_SLOT}`)), null);
  assert.equal(splitToolPage(page(`<div class="x" id="lab-tool"></div>${TOOL_SLOT}`)), null);
  // 形が違う置き場所（ほかの属性・中身あり・div 以外）だけのときも分けない
  assert.equal(splitToolPage(page(`<div id="lab-tool" class="x"></div>`)), null);
  assert.equal(splitToolPage(page(`<div id="lab-tool">x</div>`)), null);
  assert.equal(splitToolPage(page(`<span id="lab-tool"></span>`)), null);
  // script の文字列やコメントに書かれた id は要素ではないので数えない。引用符なし・空白入りの書き方の置き場所は分ける
  assert.ok(splitToolPage(page(`<script>document.getElementById("lab-tool");var s='<div id="lab-tool"></div>'</script><!-- <div id="lab-tool"></div> -->${TOOL_SLOT}<p>説明</p>`)));
  assert.ok(splitToolPage(page(`<h1>名前</h1><div id=lab-tool >\n</div><p>説明</p>`)));
});

test("ツールのページ: HTMLはブラウザと同じ規則で読む（3回目の ai-review の指摘）", () => {
  // script の中に書かれた <body> や </body> の文字は、本物の body として扱わない
  const fake = `<!doctype html><html lang="ja"><head><script>const s = \`<body>${TOOL_SLOT}</body>\`;</script></head><body><h1>名前</h1>${TOOL_SLOT}<p>説明</p></body></html>`;
  const parts = splitToolPage(fake)!;
  assert.ok(parts.top.includes("<h1>名前</h1>") && parts.bottom.includes("<p>説明</p>"));
  const cut = splitToolPage(page(`<h1>名前</h1>${TOOL_SLOT}<script>var e = "</body>";</script><p>説明</p>`))!;
  assert.ok(cut.bottom.includes("<p>説明</p>"));
  // div などの <div/> は閉じない（ブラウザでは後ろの置き場所がその中に入る）ので分けない。svg の中の /> は閉じる
  assert.equal(splitToolPage(page(`<div/>${TOOL_SLOT}<p>説明</p>`)), null);
  assert.ok(splitToolPage(page(`<svg><circle r="1"/></svg>${TOOL_SLOT}<p>説明</p>`)));
  // 文字参照で書かれた id も同じ id として数える
  assert.equal(splitToolPage(page(`${TOOL_SLOT}<span id="lab&#45;tool"></span>`)), null);
  // template の中身はページの要素にならないので数えない
  assert.ok(splitToolPage(page(`<template><div id="lab-tool"></div></template>${TOOL_SLOT}<p>説明</p>`)));
  // 公開前の撮影: 引用符なしの置き場所でも、目印の箱に差し替える。分けられないページは null
  const filled = fillToolSlot(page(`<h1>名前</h1><div id=lab-tool></div><p>説明</p>`), "<div id=\"lab-tool\">ここに動くツールが入ります</div>")!;
  assert.ok(/<h1>名前<\/h1><div id="lab-tool">ここに動くツールが入ります<\/div><p>説明<\/p>/.test(filled));
  assert.ok(filled.includes("<style>body{color:red}</style>") && filled.includes('<body class="x">'));
  assert.equal(fillToolSlot(page(`<section>${TOOL_SLOT}</section>`), "x"), null);
});

test("ツールのページの決まり: 場所が1つ・画面の高さの単位と固定を使わない・登録フォームを置かない。LPの決まりは今のまま", () => {
  const good = page(`<h1>名前</h1>${TOOL_SLOT}<section>説明</section><span data-lab="operator"></span>`);
  assert.deepEqual(staticPageIssues(good, true), []);
  assert.ok(staticPageIssues(page(`<h1>名前</h1><section>説明</section><span data-lab="operator"></span>`), true).some((x) => x.includes("lab-tool")));
  assert.ok(staticPageIssues(page(`<h1 style="min-height:100vh">名前</h1>${TOOL_SLOT}<span data-lab="operator"></span>`), true).some((x) => x.includes("vh")));
  assert.ok(staticPageIssues(page(`<h1 style="position: sticky">名前</h1>${TOOL_SLOT}<span data-lab="operator"></span>`), true).some((x) => x.includes("sticky")));
  assert.ok(staticPageIssues(page(`<h1>名前</h1>${TOOL_SLOT}<form id="signup"></form><span data-lab="operator"></span>`), true).some((x) => x.includes("フォーム")));
  // ai-review の指摘: id が signup でないフォームも止める
  assert.ok(staticPageIssues(page(`<h1>名前</h1>${TOOL_SLOT}<form id="newsletter"><input type="email"></form><span data-lab="operator"></span>`), true).some((x) => x.includes("フォーム")));
  assert.ok(staticPageIssues(page(`<section><h1>名前</h1>${TOOL_SLOT}</section><span data-lab="operator"></span>`), true).some((x) => x.includes("lab-tool")));
  // LP のページは、今までどおり登録フォームを求める
  assert.ok(staticPageIssues(good).some((x) => x.includes("登録フォーム")));
});

test("ツールのページの枠: 高さと背景色を親に知らせ、聞き直されたら知らせ直す", () => {
  const w = wrapPageHtml(page("<h1>x</h1>"));
  assert.ok(w.includes('__lab:"height"') && w.includes('__lab:"bg"'));
  assert.ok(w.includes('__lab==="ping"){h();bg()}'));
});

test("ツールのページの枠: html・body が height:100% でも、中身が伸びたら高さを知らせ直す（ブラウザで確かめる）", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page2 = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const body = `<details><summary id="q">よくある質問</summary><div style="height:2000px">答え</div></details><p id="more"></p>`;
    await page2.setContent(wrapPageHtml(page(body, `<style>html,body{height:100%;margin:0}</style><script>window.heights=[];addEventListener("message",function(e){if(e.data&&e.data.__lab==="height")window.heights.push(e.data.h)})</script>`)), { waitUntil: "load" });
    await page2.waitForTimeout(400);
    const last = () => page2.evaluate(() => { const hs = (window as unknown as { heights: number[] }).heights; return hs[hs.length - 1]; });
    const before = await last();
    assert.ok(before > 0 && before < 1000);
    // details を開く
    await page2.click("#q");
    await page2.waitForTimeout(300);
    const opened = await last();
    assert.ok(opened > 2000, `開いたあとの高さ ${opened}`);
    // スクリプトで中身を足す
    await page2.evaluate(() => { document.getElementById("more")!.style.height = "3000px"; });
    await page2.waitForTimeout(300);
    assert.ok((await last()) > opened + 2500);
  } finally {
    await browser.close();
  }
});
