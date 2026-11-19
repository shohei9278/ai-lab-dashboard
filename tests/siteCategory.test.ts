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

test("公開サイトの一覧のカテゴリ（PR #99 の ai-review の指摘）: そろえ直しは1件失敗しても残りを続け、件数と最初の理由を返す", async () => {
  const { eachSettled } = await import("../src/lib/publish");
  const seen: number[] = [];
  const r = await eachSettled([1, 2, 3, 4], async (n) => {
    seen.push(n);
    if (n === 2) throw new Error("2件目で失敗");
    if (n === 4) throw new Error("4件目で失敗");
    return n === 1;
  });
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.deepEqual(r, { changed: 1, failed: 2, firstError: "2件目で失敗" });
});

test("公開サイトの一覧のカテゴリ（PR #99 の ai-review の指摘）: APIは空の文字だけを「AIに任せる」にし、ない・おかしな値は断る", async () => {
  const { POST } = await import("../src/app/api/loop/route");
  const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/loop", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const id = add("tool", "calc");
  await setSiteCategory(id, "game");
  for (const category of [undefined, null, 3, { k: "game" }, "play"]) {
    const res = await post({ action: "site-category", projectId: id, ...(category === undefined ? {} : { category }) });
    assert.equal(res.status, 400, JSON.stringify(category));
    assert.equal(getProject(id)!.site_category, "game", JSON.stringify(category));
  }
  const ok = await post({ action: "site-category", projectId: id, category: "" });
  assert.equal(ok.status, 200);
  assert.equal(getProject(id)!.site_category, null);
});

test("公開サイトの一覧のカテゴリ（PR #99 の ai-review の指摘）: 同じ案件の判定が同時に頼まれたら、走っている判定を待つ（AIを2回呼ばない）。終わったらまた頼める", async () => {
  const p = getProject(add("tool"))!;
  const a = classifySiteCategory(p);
  const b = classifySiteCategory(p);
  assert.equal(a, b);
  // テストではAIのキーがないので、どちらも同じ失敗で終わる
  await assert.rejects(a);
  await assert.rejects(b);
  const c = classifySiteCategory(p);
  assert.notEqual(c, a);
  await assert.rejects(c);
});
