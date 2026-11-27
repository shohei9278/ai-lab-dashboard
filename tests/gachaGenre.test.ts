import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { GACHA_GENRE, GENRES, genreOnceOf, ideaGenresFor, isGachaGenre } from "../src/lib/aims";
import { GACHA_STAGING_RULE, toolRules } from "../src/lib/loop";

// 「ガチャ・くじ」と「診断」を分け、結果が出るまでの盛り上げる演出は、ガチャ・くじのツールにだけ付ける（11/27 に運営者が決めた。診断には付けない）

test("ジャンル: ガチャ・くじ と 診断 を分ける。分ける前の「ガチャ・診断」は、診断かもしれないのでガチャ・くじとして数えない", () => {
  assert.ok(GENRES.includes(GACHA_GENRE));
  assert.ok(GENRES.includes("診断"));
  assert.ok(!(GENRES as readonly string[]).includes("ガチャ・診断"));
  assert.equal(isGachaGenre("ガチャ・くじ"), true);
  assert.equal(isGachaGenre("ガチャ"), true);
  assert.equal(isGachaGenre("おみくじ"), true);
  assert.equal(isGachaGenre("診断"), false);
  assert.equal(isGachaGenre("ガチャ・診断"), false);
  assert.equal(isGachaGenre("クイズ"), false);
  assert.equal(isGachaGenre(null), false);
});

test("作るときの決まり: 演出の作り方は、ガチャ・くじのツールにだけ入る", () => {
  assert.ok(toolRules(null, true, "ガチャ・くじ").includes(GACHA_STAGING_RULE));
  assert.ok(!toolRules(null, true, "診断").includes(GACHA_STAGING_RULE));
  assert.ok(!toolRules(null, true, null).includes(GACHA_STAGING_RULE));
  // 確定演出は外さない・2回目からは飛ばせる・確率を書く・お金や景品は扱わない
  assert.match(GACHA_STAGING_RULE, /確定演出.*必ず/);
  assert.match(GACHA_STAGING_RULE, /2回目からは.*飛ばせる/);
  assert.match(GACHA_STAGING_RULE, /確率を画面/);
  assert.match(GACHA_STAGING_RULE, /お金・景品は扱わない/);
  // 共通の決まり（結果をすぐ出す・まだ見つけていないものから選ぶ）とぶつかる所は、ガチャ・くじでの読み方を書く（PR #221 の ai-review の指摘）
  assert.match(GACHA_STAGING_RULE, /押したらすぐ演出を始める/);
  assert.match(GACHA_STAGING_RULE, /結果を先に見せてから演出しない/);
  assert.match(GACHA_STAGING_RULE, /画面に書いた確率どおり/);
});

test("手のアイデア出しのジャンル（11/27 に運営者が決めた）: その回だけ選んだジャンルを使い、設定の画面のジャンルは変えない。一覧にない言葉は受け付けない", () => {
  assert.equal(genreOnceOf("ガチャ・くじ"), "ガチャ・くじ");
  assert.equal(genreOnceOf("診断"), "診断");
  assert.equal(genreOnceOf("好きな言葉を足してほしい"), undefined);
  assert.equal(genreOnceOf(""), undefined);
  assert.equal(genreOnceOf(3), undefined);
  // その回のジャンルがあれば、それだけを使う。なければ設定どおり（空ならおまかせ）
  assert.deepEqual(ideaGenresFor("クイズ,手ざわり", "ガチャ・くじ"), ["ガチャ・くじ"]);
  assert.deepEqual(ideaGenresFor("クイズ,手ざわり"), ["クイズ", "手ざわり"]);
  assert.deepEqual(ideaGenresFor(""), []);
});
