import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { checkToolCheckJump, recentToolCheckIssues, toolCheckText, toolCheckWeeks } from "../src/lib/toolCheckStats";

// ツールのチェックの止めた割合（運営者が決めた）: 週ごとに、記録があれば記録で、記録の前は概算で出す

test("ツールのチェックの止めた割合: 記録の週はAIが止めた数で、記録の前の週は呼び出しと経過からの概算で出す", () => {
  db().exec("DELETE FROM tool_checks; DELETE FROM ai_calls; DELETE FROM events WHERE kind = 'review'");
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('和菓子', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  // 3週間前: チェック10回、止めた経過3件（概算）
  const call = db().prepare("INSERT INTO ai_calls (purpose, model_id, input_tokens, output_tokens, cost_usd, at) VALUES ('ツールチェック', 'claude-opus-5-5', 1, 1, 0.01, datetime('now', '-21 days'))");
  for (let i = 0; i < 10; i++) call.run();
  db().prepare("INSERT INTO ai_calls (purpose, model_id, input_tokens, output_tokens, cost_usd, error, at) VALUES ('ツールチェック', 'claude-opus-5-5', 1, 1, 0, 'x', datetime('now', '-21 days'))").run(); // 失敗した呼び出しは数えない
  const ev = db().prepare("INSERT INTO events (project_id, actor, kind, message, at) VALUES (?, 'ai', 'review', ?, datetime('now', '-21 days'))");
  ev.run(pid, "ツールのチェックで問題が見つかったため書き直し: x");
  ev.run(pid, "ツールのチェックで問題が見つかったため書き直し: y");
  ev.run(pid, "Claude Code で作ったツールのチェックで指摘があります（公開の判断待ちに出します）: z");
  ev.run(pid, "ほかの経過"); // 数えない
  // 今週: 記録4回、AIが止めたのは1回（決まり・自動テストだけの指摘は、AIが止めた数に入れない）
  const rec = db().prepare("INSERT INTO tool_checks (project_id, by, ai_ok, ai_issues, static_issues, test_issues) VALUES (?, ?, ?, ?, ?, ?)");
  rec.run(pid, "ai", 1, "[]", 0, 0);
  rec.run(pid, "ai", 1, "[]", 1, 0);
  rec.run(pid, "claude-code", 0, JSON.stringify(["レアが2回目に出ない"]), 0, 0);
  rec.run(pid, "ai", 1, "[]", 0, 2);
  const weeks = toolCheckWeeks();
  assert.equal(weeks.length, 8);
  const now = weeks.at(-1)!;
  assert.deepEqual([now.checks, now.flagged, now.rate, now.estimate, now.byClaudeCode], [4, 1, 0.25, false, 1]);
  const past = weeks.find((w) => w.checks === 10)!;
  assert.deepEqual([past.flagged, past.rate, past.estimate], [3, 0.3, true]);
  // 記録より前の週だけ概算にする（記録を始めた週は記録だけ）
  assert.ok(weeks.filter((w) => w.week >= now.week).every((w) => !w.estimate));
  assert.deepEqual(recentToolCheckIssues().map((x) => [x.title, x.by, x.issues]), [["和菓子", "claude-code", ["レアが2回目に出ない"]]]);
});

test("ツールのチェックの止めた割合: チェックがない週は割合を出さない", () => {
  db().exec("DELETE FROM tool_checks; DELETE FROM ai_calls; DELETE FROM events WHERE kind = 'review'");
  const weeks = toolCheckWeeks(4);
  assert.equal(weeks.length, 4);
  assert.ok(weeks.every((w) => w.checks === 0 && w.rate === null));
});

const seedPast = (pid: number, weeksAgo: number, checks: number, flagged: number) => {
  const at = `-${weeksAgo * 7} days`;
  for (let i = 0; i < checks; i++) db().prepare("INSERT INTO ai_calls (purpose, model_id, input_tokens, output_tokens, cost_usd, at) VALUES ('ツールチェック', 'claude-opus-5-5', 1, 1, 0.01, datetime('now', ?))").run(at);
  for (let i = 0; i < flagged; i++) db().prepare("INSERT INTO events (project_id, actor, kind, message, at) VALUES (?, 'ai', 'review', 'ツールのチェックで問題が見つかったため書き直し: x', datetime('now', ?))").run(pid, at);
};

test("定例会議の材料: 週ごとの止めた割合と、最近止めたときの指摘を渡す", () => {
  db().exec("DELETE FROM tool_checks; DELETE FROM ai_calls; DELETE FROM events WHERE kind = 'review'");
  assert.match(toolCheckText(), /まだチェックがない/);
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('レアの箱', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  seedPast(pid, 2, 10, 2);
  db().prepare("INSERT INTO tool_checks (project_id, by, ai_ok, ai_issues) VALUES (?, 'ai', 0, ?)").run(pid, JSON.stringify(["レアが2回目に出ない"]));
  const t = toolCheckText();
  assert.match(t, /10回中2回止めた（20%）・概算/);
  assert.match(t, /1回中1回止めた（100%）/);
  assert.match(t, /最近AIのチェックが止めたときの指摘:\n- レアの箱: レアが2回目に出ない/);
});

test("急に上がったら知らせる: 今週5回以上で、前の週の平均より15ポイント以上高いとき。1週に1回まで", () => {
  db().exec("DELETE FROM tool_checks; DELETE FROM ai_calls; DELETE FROM events WHERE kind IN ('review', 'tool-check-alert')");
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('知らせ', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  seedPast(pid, 3, 10, 2); // 20%
  seedPast(pid, 2, 10, 2); // 20%
  seedPast(pid, 1, 10, 3); // 30%
  const rec = db().prepare("INSERT INTO tool_checks (project_id, by, ai_ok, ai_issues) VALUES (?, 'ai', ?, '[]')");
  // 今週4回中3回: 回数が足りないので知らせない
  [0, 0, 0, 1].forEach((ok) => rec.run(pid, ok));
  assert.equal(checkToolCheckJump(), null);
  // 5回中3回（60%）: 前の3週の平均（約23%）より15ポイント以上高い
  rec.run(pid, 1);
  assert.match(checkToolCheckJump() ?? "", /5回中3回（60%）。前の3週の平均は23%/);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'tool-check-alert'").get() as { n: number }).n, 1);
  assert.equal(checkToolCheckJump(), null, "同じ週は1回だけ");
});

test("急に上がったら知らせる: 前の割合と変わらなければ知らせない", () => {
  db().exec("DELETE FROM tool_checks; DELETE FROM ai_calls; DELETE FROM events WHERE kind IN ('review', 'tool-check-alert')");
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('ふつう', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  seedPast(pid, 2, 10, 3);
  seedPast(pid, 1, 10, 3);
  const rec = db().prepare("INSERT INTO tool_checks (project_id, by, ai_ok, ai_issues) VALUES (?, 'ai', ?, '[]')");
  [0, 0, 1, 1, 1, 1].forEach((ok) => rec.run(pid, ok)); // 33%
  assert.equal(checkToolCheckJump(), null);
});
