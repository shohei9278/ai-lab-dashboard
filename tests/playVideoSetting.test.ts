import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { makePlayVideoOnPublish } from "../src/lib/playVideo";

// 遊ぶ様子の動画は、必要なときだけ作る（運営者が決めた）。公開したときに自動で作るのは、設定でオンにしたときだけ（最初はオフ）

const events = (id: number) => (db().prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ?").get(id) as { n: number }).n;

test("遊ぶ様子の動画: 最初はオフで、公開しても自動では作らない。オンにすると作り始める", async () => {
  assert.equal(getSettings().playVideoOnPublish, false);
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 'spread')").run().lastInsertRowid);
  makePlayVideoOnPublish({ id, kind: "tool", aim: "spread" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(events(id), 0, "オフのときは作り始めない");
  // オンにすると作り始める（この試しでは AI のキーがないので、作れなかったと経過に残る）
  saveSettings({ playVideoOnPublish: true });
  makePlayVideoOnPublish({ id, kind: "tool", aim: "spread" });
  for (let i = 0; i < 50 && !events(id); i++) await new Promise((r) => setTimeout(r, 100));
  assert.ok(events(id) > 0, "オンのときは作り始める");
  // ねらいが「広がる」でないツールは、オンでも作らない
  const other = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('u', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 'useful')").run().lastInsertRowid);
  makePlayVideoOnPublish({ id: other, kind: "tool", aim: "useful" });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(events(other), 0);
  saveSettings({ playVideoOnPublish: false });
});
