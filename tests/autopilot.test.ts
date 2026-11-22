import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { applyAutopilot, autopilotLevel, autopilotTick, autoSettings } from "../src/lib/autopilot";

// 予算の自動運転: 月の予算のペースに合わせて、費用のかかる設定を自動で絞る（人が決めた値より増やさない）

const budget = (projected: number, creativeOk = true) => ({ budget: 10000, projected, creativeOk }) as Parameters<typeof autopilotLevel>[0];

test("自動運転: 月末の見込みで段階を決める（月の初めの数日はふつう。創作の分を使い切ったら節約）", () => {
  assert.equal(autopilotLevel(budget(9000), 10).level, "normal");
  assert.equal(autopilotLevel(budget(11000), 10).level, "careful");
  assert.equal(autopilotLevel(budget(13000), 10).level, "saving");
  assert.equal(autopilotLevel(budget(30000), 2).level, "normal");
  assert.equal(autopilotLevel(budget(1000, false), 2).level, "saving");
});

test("自動運転: 段階に合わせて絞り、人が決めた値より増やさない。オフなら絞らない", () => {
  const s = { ...getSettings(), budgetAutopilot: true, dailyIdeaCount: 3, spreadPerDay: 2, illustrations: true, playVideoOnPublish: true, deepPerWeek: 2 };
  assert.deepEqual(applyAutopilot(s, "normal"), s);
  const c = applyAutopilot(s, "careful");
  assert.deepEqual([c.dailyIdeaCount, c.spreadPerDay, c.illustrations, c.playVideoOnPublish, c.deepPerWeek], [2, 2, true, false, 1]);
  const v = applyAutopilot(s, "saving");
  assert.deepEqual([v.dailyIdeaCount, v.spreadPerDay, v.illustrations, v.playVideoOnPublish, v.deepPerWeek], [1, 1, false, false, 0]);
  // 人が0にしていたものを増やさない
  const zero = applyAutopilot({ ...s, spreadPerDay: 0, deepPerWeek: 0 }, "careful");
  assert.deepEqual([zero.spreadPerDay, zero.deepPerWeek], [0, 0]);
  assert.deepEqual(applyAutopilot({ ...s, budgetAutopilot: false }, "saving"), { ...s, budgetAutopilot: false });
});

test("自動運転: 段階が変わったときだけ記録し、設定の画面の値（人が決めた値）は書き換えない", () => {
  const events = () => (db().prepare("SELECT message FROM events WHERE kind = 'autopilot' ORDER BY id").all() as { message: string }[]).map((r) => r.message);
  db().prepare("DELETE FROM events WHERE kind = 'autopilot'").run();
  db().prepare("DELETE FROM ai_calls").run();
  saveSettings({ budgetAutopilot: true, autopilotLevel: "normal", monthlyBudgetJpy: 10000, dailyIdeaCount: 3, illustrations: true });
  autopilotTick();
  assert.deepEqual(events(), []);
  // 今月すでに予算の9割を使った（創作の分を使い切った）→ 節約
  db().prepare("INSERT INTO ai_calls (purpose, model_id, input_tokens, output_tokens, cost_usd) VALUES ('試し', 'claude-opus-5-5', 0, 0, ?)").run(9000 / getSettings().usdJpy);
  autopilotTick();
  autopilotTick();
  assert.equal(events().length, 1);
  assert.match(events()[0], /「ふつう」から「節約」/);
  assert.equal(getSettings().autopilotLevel, "saving");
  assert.equal(getSettings().dailyIdeaCount, 3);
  assert.equal(autoSettings().dailyIdeaCount, 1);
  assert.equal(autoSettings().illustrations, false);
  // オフにすると、ふつうに戻ったと記録し、絞らない
  saveSettings({ budgetAutopilot: false });
  autopilotTick();
  assert.match(events()[1], /「節約」から「ふつう」.*自動運転をオフ/);
  assert.equal(autoSettings().illustrations, true);
  db().prepare("DELETE FROM ai_calls").run();
  saveSettings({ budgetAutopilot: true, autopilotLevel: "normal" });
});
