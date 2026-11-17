import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { splitToolPage, TOOL_SLOT, wrapPageHtml } from "../lp-site/src/lp/pageHtml";
import { staticPageIssues } from "../src/lib/freePage";

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
