import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLp } from "../lp-site/src/lp/content";
import { buildPrompt } from "../src/lib/illustration";

const base = { headline: "見出し", subheadline: "補足", pains: ["悩み"], features: [{ title: "特徴", body: "説明" }], cta: "使う", faq: [], design: { theme: "warm" } };

test("紹介イラスト: 選んだ画風を残し、知らない画風や prototype の名前は落とす", () => {
  assert.equal(normalizeLp({ ...base, illustrationStyle: "photo" }).illustrationStyle, "photo");
  assert.equal(normalizeLp({ ...base, illustrationStyle: "oil" }).illustrationStyle, undefined);
  assert.equal(normalizeLp({ ...base, illustrationStyle: "toString" }).illustrationStyle, undefined);
  assert.equal(normalizeLp(base).illustrationStyle, undefined);
});

test("紹介イラスト: 選んだ画風の描き方と、崩れやすいものを描かない決まりと、小さく見せる構図を渡す", () => {
  const lp = normalizeLp({ ...base, illustrationStyle: "photo", illustrationPrompt: "A single steaming bowl of ramen on a wooden counter." });
  const prompt = buildPrompt(lp, "くもりメガネ");
  assert.ok(prompt.startsWith("A single steaming bowl of ramen"));
  assert.match(prompt, /photographic still life/);
  assert.doesNotMatch(prompt, /flat vector/);
  assert.match(prompt, /no hands, no people, no faces/);
  assert.match(prompt, /no phone or computer screens/);
  assert.match(prompt, /small thumbnail/);
});

test("紹介イラスト: 画風のない古いLPは、平らなイラストで描く", () => {
  const prompt = buildPrompt(normalizeLp({ ...base, illustrationPrompt: "A calm scene." }), "t");
  assert.match(prompt, /flat vector illustration/);
  assert.match(prompt, /no hands/);
});
