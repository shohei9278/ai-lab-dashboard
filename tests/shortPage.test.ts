import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { SHORT_PAGE_AIMS, shortToolPage } from "../src/lib/loop";
import { normalizeLp } from "../lp-site/src/lp/content";

const base = { headline: "h", subheadline: "s", cta: "c", pains: [], features: [], faq: [] };

test("ツールの短いページ（運営者の依頼）: 広がる・また来てもらうのツールは紹介ページを作らない。役に立つ・需要を確かめるは今までどおり", () => {
  assert.deepEqual(SHORT_PAGE_AIMS, ["spread", "return"]);
  assert.equal(shortToolPage("spread"), true);
  assert.equal(shortToolPage("return"), true);
  assert.equal(shortToolPage("useful"), false);
  assert.equal(shortToolPage("demand"), false);
  // ねらいのない前からある案件は、今までどおり
  assert.equal(shortToolPage(null), false);
});

test("ツールの短いページ: 印（short）は、ツールのある中身でだけ残す", () => {
  const tool = { html: "<button>押す</button><script>1</script>", shareText: "s" };
  assert.equal(normalizeLp({ ...base, tool, short: true }).short, true);
  // ツールのない事前登録のページや、印が true でないものには付けない
  assert.equal(normalizeLp({ ...base, short: true }).short, undefined);
  assert.equal(normalizeLp({ ...base, tool, short: "yes" }).short, undefined);
  assert.equal(normalizeLp({ ...base, tool }).short, undefined);
});
