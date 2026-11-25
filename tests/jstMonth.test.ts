import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, monthSpendBreakdownUsd } from "../src/lib/db";

// 「今月」「今日」は日本時間で区切る（11/22 の見直しのルーティンが見つけた。毎月1日の0〜9時に先月の分が今月に入っていた）

test("今月のAI費用: 日本時間の月で数える（日本時間の月の初めより前は、世界時で同じ月でも数えない）", () => {
  db().exec("DELETE FROM ai_calls; DELETE FROM runs");
  const add = db().prepare("INSERT INTO ai_calls (purpose, model_id, input_tokens, output_tokens, cost_usd, at) VALUES ('t', 'claude-opus-5-5', 1, 1, ?, datetime('now', '+9 hours', 'start of month', '-9 hours', ?))");
  add.run(1, "-1 minutes"); // 日本時間で先月の最後の1分（世界時では、日本時間の月の初めの9時間前）
  add.run(2, "+1 minutes"); // 日本時間で今月の最初の1分
  assert.equal(monthSpendBreakdownUsd().loop, 2);
});

test("本番の作業中: 名前の付いた作業がないときは、呼んでいる途中のAIを出す（マージの前の確かめで見落とさない）", async () => {
  const { activitiesWithCalls } = await import("../src/lib/live");
  const { tracked } = await import("../src/lib/ai");
  const { withActivity } = await import("../src/lib/loop");
  assert.deepEqual(activitiesWithCalls(), []);
  let seen: ReturnType<typeof activitiesWithCalls> = [];
  await tracked("claude-opus-5-5", "毎日の計画", 7, async () => { seen = activitiesWithCalls(); });
  assert.deepEqual(seen.map((a) => [a.title, a.projectId, Object.values(a.steps)[0]]), [["毎日の計画", 7, "AIを呼んでいます"]]);
  assert.deepEqual(activitiesWithCalls(), [], "終わったら消える");
  // 名前の付いた作業があれば、そちらだけを出す（同じ作業を2つに見せない）
  await withActivity({ key: "t-act", title: "朝会", models: ["claude-opus-5-5"], room: "meeting", doing: "朝会", projectId: null }, async () => {
    await tracked("claude-opus-5-5", "毎日の計画", undefined, async () => { seen = activitiesWithCalls(); });
  });
  assert.deepEqual(seen.map((a) => a.title), ["朝会"]);
});
