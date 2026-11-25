import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { hotIdeaHint, hotProjects, hotText } from "../src/lib/hot";
import { jstDay } from "../src/lib/sns";

// 当たりの兆し（運営者が決めた）: 昨日、普段より訪問か利用が跳ねた案件に、翌朝の計画を集中させる

const D = 86_400_000;
const day = (back: number) => jstDay(new Date(Date.now() - back * D));
const live = (title: string, publishedDaysAgo = 30) =>
  Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, published_at, public_slug) VALUES (?, '料理をする人', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', datetime('now', ?), ?)")
    .run(title, `-${publishedDaysAgo} days`, `hot-${title}-${Math.random().toString(36).slice(2, 8)}`).lastInsertRowid);
const metric = (id: number, back: number, visits: number, signups = 0) =>
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, ?, ?, 'real')").run(id, day(back), visits, signups);
const reset = () => db().exec("UPDATE projects SET stage = 'killed' WHERE stage = 'live'; DELETE FROM events WHERE kind = 'hot-project'");

test("当たりの兆し: 昨日の訪問が下限（10人）以上で普段の3倍以上の案件だけ。利用でも見る。普段は公開していた日で割り、3日に満たない案件は見ない", () => {
  reset();
  const jump = live("跳ねた");
  for (let b = 2; b <= 8; b++) metric(jump, b, 3);
  metric(jump, 1, 12); // 普段3人 → 12人（4倍）
  const steady = live("いつもどおり");
  for (let b = 2; b <= 8; b++) metric(steady, b, 8);
  metric(steady, 1, 20); // 2.5倍なので見ない
  const few = live("少ない");
  metric(few, 1, 9); // 普段0人でも、下限に届かないので見ない
  const uses = live("利用が跳ねた");
  for (let b = 2; b <= 8; b++) metric(uses, b, 5, 0);
  metric(uses, 1, 6, 4); // 訪問は普通だが、利用が普段0 → 4人
  const fresh = live("公開したばかり", 2);
  metric(fresh, 1, 30); // 普段に数える日が足りないので見ない
  const hot = hotProjects();
  assert.deepEqual(hot.map((h) => h.id), [jump, uses]);
  assert.equal(hot[0].baseVisits, 3);
  assert.match(hot[0].why, /昨日 訪問12人（普段は1日3人）/);
  assert.match(hot[1].why, /利用・登録4人/);
  assert.match(hotText(hot), /当たりの兆し[^]*跳ねた[^]*利用が跳ねた/);
  assert.match(hotText([]), /なし/);
});

test("当たりの兆し: 公開して数日の案件は、公開した日の翌日からを普段として割る", () => {
  reset();
  const p = live("公開5日目", 5);
  // 公開した日の翌日から昨日の前日までの3日に、1日2人ずつ
  for (const b of [2, 3, 4]) metric(p, b, 2);
  metric(p, 1, 10);
  const [h] = hotProjects();
  assert.deepEqual([h?.id, h?.baseVisits], [p, 2]);
});

test("朝会: 当たりの兆しがあれば、AIが休むと書かなくても新しい案件づくりを休み、材料と記録に残す。次のアイデア出しに派生の候補として渡す", async () => {
  reset();
  const { createPlan, planPausesNew } = await import("../src/lib/plan");
  db().exec("DELETE FROM daily_plans");
  const p = live("朝会で跳ねた");
  for (let b = 2; b <= 8; b++) metric(p, b, 2);
  metric(p, 1, 15);
  let planUser = "";
  let planSystem = "";
  const ask = async <T,>(o: { purpose: string; system: string; user: string; validate: (v: unknown) => v is T }): Promise<T> => {
    let v: unknown;
    if (o.purpose === "毎日の計画") {
      planUser = o.user;
      planSystem = o.system;
      v = { bottleneck: "reach", evidence: "e", certainty: "low", review: "r", focus: "f", goals: [], pause_new: false, pause_reason: "", idea_note: "", research: null, tasks: [] };
    } else if (o.purpose === "朝会（意見）") v = { opinion: "意見" };
    else if (o.purpose === "投稿の切り口の分類") v = { types: [] };
    else throw new Error(`想定していない呼び出し: ${o.purpose}`);
    assert.ok(o.validate(v), o.purpose);
    return v as T;
  };
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
  const before = keys.map((k) => process.env[k]);
  keys.forEach((k) => (process.env[k] = "test-dummy"));
  try {
    await createPlan({ force: true, ask: ask as never, weather: async () => [] });
  } finally {
    keys.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
  }
  assert.match(planUser, /当たりの兆し[^]*朝会で跳ねた: 昨日 訪問15人/);
  assert.match(planSystem, /当たりの兆し: 材料の「当たりの兆し」/);
  assert.match(planPausesNew() ?? "", /当たりの兆し[^]*新しい案件づくりを休み/);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'hot-project' AND project_id = ?").get(p) as { n: number }).n, 1);
  assert.match(hotIdeaHint(), /派生を考えてよい[^]*朝会で跳ねた（対象: 料理をする人）/);
});

test("当たりの兆し: 朝会のAIが失敗しても、見つけた案件は記録する。計画を作り直しても同じ日・同じ案件は1件だけ", async () => {
  reset();
  const { createPlan } = await import("../src/lib/plan");
  db().exec("DELETE FROM daily_plans");
  const p = live("朝会が失敗");
  for (let b = 2; b <= 8; b++) metric(p, b, 2);
  metric(p, 1, 15);
  const fail = (async (o: { purpose: string; validate: (v: unknown) => boolean }) => {
    if (o.purpose === "投稿の切り口の分類") return { types: [] };
    if (o.purpose === "朝会（意見）") return { opinion: "意見" };
    throw new Error("予算の上限");
  }) as never;
  await assert.rejects(createPlan({ force: true, ask: fail, weather: async () => [] }), /予算の上限/);
  await assert.rejects(createPlan({ force: true, ask: fail, weather: async () => [] }), /予算の上限/);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'hot-project' AND project_id = ?").get(p) as { n: number }).n, 1);
  assert.match(hotIdeaHint(), /朝会が失敗/);
});

test("当たりの兆し: 跳ねた案件がなければ、休むかどうかはAIの判断のまま。アイデア出しにも何も足さない", () => {
  reset();
  const p = live("ふつう");
  for (let b = 1; b <= 8; b++) metric(p, b, 4);
  assert.deepEqual(hotProjects(), []);
  assert.equal(hotIdeaHint(), "");
});
