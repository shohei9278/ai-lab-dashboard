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
  assert.match(prompt, /no screens or monitors of any kind/);
  assert.match(prompt, /small thumbnail/);
});

test("紹介イラスト: 画風のない古いLPは、平らなイラストで描く", () => {
  const prompt = buildPrompt(normalizeLp({ ...base, illustrationPrompt: "A calm scene." }), "t");
  assert.match(prompt, /flat vector illustration/);
  assert.match(prompt, /no hands/);
});

test("紹介イラスト: やわらかい立体は、写真ではなく作った立体のイラストとして描かせる", () => {
  const prompt = buildPrompt(normalizeLp({ ...base, illustrationStyle: "soft3d", illustrationPrompt: "A small cup of matcha on a tray." }), "t");
  assert.match(prompt, /stylized 3D illustration/);
  assert.match(prompt, /not a photograph/);
  assert.doesNotMatch(prompt, /photographic still life/);
});

test("紹介イラスト: 物が2つ以上書かれていても、いちばん大事な物を1つだけ描かせる", () => {
  const prompt = buildPrompt(normalizeLp({ ...base, illustrationStyle: "flat", illustrationPrompt: "A teapot and two cups and a plate of sweets." }), "t");
  assert.match(prompt, /exactly one main object/);
  assert.match(prompt, /first object named in the description/);
  assert.match(prompt, /no laptops/);
});
