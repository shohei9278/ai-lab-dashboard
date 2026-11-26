import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLp } from "../lp-site/src/lp/content";

// 提案箱 #71: design.order に並べた部分のうち、中身のないものは表示順から外す
const base = { headline: "見出し", subheadline: "補足", pains: ["悩み"], features: [{ title: "特徴", body: "説明" }], cta: "使う", faq: [] };

test("order にあっても中身のない部分（beforeAfter・faq）は外し、選んだ順は保つ", () => {
  const lp = normalizeLp({ ...base, design: { theme: "warm", order: ["beforeAfter", "features", "pains", "faq"] } });
  assert.deepEqual(lp.design?.order, ["features", "pains"]);
});

test("中身があれば、選ばれなかった部分も後ろに付ける", () => {
  const lp = normalizeLp({
    ...base,
    faq: [{ q: "質問", a: "回答" }],
    steps: [{ title: "1", body: "a" }, { title: "2", body: "b" }],
    beforeAfter: { before: ["前"], after: ["後"] },
    design: { theme: "warm", order: ["faq", "pains"] },
  });
  assert.deepEqual(lp.design?.order, ["faq", "pains", "beforeAfter", "features", "steps"]);
});

test("形が足りず落とされた中身（1つだけの steps・after のない beforeAfter）は、order にも残さない", () => {
  const lp = normalizeLp({
    ...base,
    steps: [{ title: "1", body: "a" }],
    beforeAfter: { before: ["前"], after: [] },
    design: { theme: "warm", order: ["steps", "beforeAfter", "pains", "features"] },
  });
  assert.equal(lp.steps, undefined);
  assert.equal(lp.beforeAfter, undefined);
  assert.deepEqual(lp.design?.order, ["pains", "features"]);
});

test("一度整えたものをもう一度整えても、同じ順になる", () => {
  const once = normalizeLp({ ...base, design: { theme: "warm", order: ["features", "beforeAfter", "pains"] } });
  assert.deepEqual(normalizeLp(once).design?.order, once.design?.order);
});
