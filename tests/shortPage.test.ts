import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FIT_SCREEN_RULE, SHORT_PAGE_AIMS, devRequestText, shortToolPage } from "../src/lib/loop";
import { db } from "../src/lib/db";
import { normalizeLp } from "../lp-site/src/lp/content";
import { pickOthers } from "../lp-site/src/lp/categories";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

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

test("遊びのツールの全画面（運営者の依頼）: 枠を画面の高さに決めるときだけ、枠の中で引っぱっても外のページが動かないようにする", () => {
  assert.match(wrapToolHtml("<p>x</p>", { fill: true }), /html,body\{overscroll-behavior:none\}/);
  assert.doesNotMatch(wrapToolHtml("<p>x</p>"), /overscroll-behavior/);
});

test("遊びのツールの結果のあとの「ほかの遊び」: 同じカテゴリを先に、足りなければほかのツールで埋める。自分は出さない", () => {
  const t = (slug: string, category: string | null) => ({ slug, category });
  const list = [t("a", "quiz"), t("me", "game"), t("b", "game"), t("c", null), t("d", "game"), t("e", "calc")];
  assert.deepEqual(pickOthers(list, "me").map((x) => x.slug), ["b", "d", "a"]);
  assert.deepEqual(pickOthers(list, "me", 5).map((x) => x.slug), ["b", "d", "a", "c", "e"]);
  // カテゴリがないツール・一覧にないツールは、一覧の順のまま
  assert.deepEqual(pickOthers(list, "c").map((x) => x.slug), ["a", "me", "b"]);
  assert.deepEqual(pickOthers(list, "zz", 2).map((x) => x.slug), ["a", "me"]);
  assert.deepEqual(pickOthers([t("me", "game")], "me"), []);
});

test("遊びのツールを1画面に収める（#66 で運営者が見つけた）: 短いページで出すツールの作る決まりにだけ、画面の高さに収める決まりを足す", () => {
  const add = (aim: string | null) => Number(db().prepare(
    "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('t', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool', ?)",
  ).run(aim).lastInsertRowid);
  assert.match(FIT_SCREEN_RULE, /画面いっぱいの枠/);
  assert.match(FIT_SCREEN_RULE, /28pxの細い帯/); // 遊ぶ画面の上には細い帯だけがあり、その下が枠になる（運営者が決めた遊ぶ画面の作り）
  assert.match(FIT_SCREEN_RULE, /640px/);
  assert.match(FIT_SCREEN_RULE, /100dvh/);
  // 広がる・また来てもらうのツール（短いページ）には入れる
  assert.ok(devRequestText(add("spread"), "設計", null).includes(FIT_SCREEN_RULE));
  assert.ok(devRequestText(add("return"), "設計", null).includes(FIT_SCREEN_RULE));
  // 紹介ページのあるツール（枠がツールの高さに合わせて伸びる）には入れない
  assert.ok(!devRequestText(add("useful"), "設計", null).includes(FIT_SCREEN_RULE));
  assert.ok(!devRequestText(add(null), "設計", null).includes(FIT_SCREEN_RULE));
});
