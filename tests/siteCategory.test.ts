import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { getProject, setSiteCategory } from "../src/lib/loop";
import { classifySiteCategory, parseCategoryAnswer, siteCategoryOf } from "../src/lib/siteCategory";
import { SITE_CATEGORY_KEYS } from "../lp-site/src/lp/categories";

const add = (kind = "tool", auto: string | null = null) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, site_category_auto) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', ?, 'spread', ?)",
).run(kind, auto).lastInsertRowid);

test("公開サイトの一覧のカテゴリ（運営者の依頼）: 中身の種類の8つ。運営者が選んだものが先、なければAIの判定", () => {
  assert.deepEqual(SITE_CATEGORY_KEYS, ["shindan", "game", "quiz", "maker", "words", "calc", "organize", "visual"]);
  assert.equal(siteCategoryOf({ site_category: null, site_category_auto: "calc" }), "calc");
  assert.equal(siteCategoryOf({ site_category: "game", site_category_auto: "calc" }), "game");
  // 合うものがない（none）・まだ判定していない・一覧にないものは、カテゴリなし（一覧では「そのほか」）
  assert.equal(siteCategoryOf({ site_category: null, site_category_auto: "none" }), null);
  assert.equal(siteCategoryOf({ site_category: null, site_category_auto: null }), null);
  assert.equal(siteCategoryOf({ site_category: "play", site_category_auto: "useful" }), null);
  // AIの答えは、一覧にあるキーだけ使う
  assert.equal(parseCategoryAnswer({ category: "shindan" }), "shindan");
  assert.equal(parseCategoryAnswer({ category: null }), null);
  assert.equal(parseCategoryAnswer({ category: "ゲーム" }), null);
  assert.equal(parseCategoryAnswer("calc"), null);
});

test("公開サイトの一覧のカテゴリ: 判定済みのツールはAIを呼ばない。LPは分けない", async () => {
  // テストではAIのキーがないので、呼べば失敗する。判定済みなら呼ばずに返す
  assert.equal(await classifySiteCategory(getProject(add("tool", "maker"))!), "maker");
  assert.equal(await classifySiteCategory(getProject(add("tool", "none"))!), null);
  assert.equal(await classifySiteCategory(getProject(add("lp"))!), null);
  await assert.rejects(classifySiteCategory(getProject(add("tool"))!));
});

test("公開サイトの一覧のカテゴリ: 運営者が案件の画面で選び直せる。空に戻すとAIの判定に任せる", async () => {
  const id = add("tool", "calc");
  await setSiteCategory(id, "game");
  assert.equal(getProject(id)!.site_category, "game");
  assert.equal(siteCategoryOf(getProject(id)!), "game");
  const last = () => (db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'site-category' ORDER BY id DESC").get(id) as { message: string }).message;
  assert.match(last(), /「ゲーム」にしました/);
  await setSiteCategory(id, null);
  assert.equal(getProject(id)!.site_category, null);
  assert.match(last(), /「計算・見積もり」にしました（AIの判定に任せる）/);
  // まだ公開しておらず判定もないツールは、公開するときにAIが選ぶ
  const fresh = add("tool");
  await setSiteCategory(fresh, null);
  assert.match((db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'site-category'").get(fresh) as { message: string }).message, /まだ決まっていない状態（公開するときにAIが選ぶ）/);
  await assert.rejects(setSiteCategory(id, "play"), /カテゴリが決めたものではありません/);
  await assert.rejects(setSiteCategory(add("lp"), "calc"), /動くツールの案件だけ/);
});
