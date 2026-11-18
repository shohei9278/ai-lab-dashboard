import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { ongoingCalls, tracked } from "../src/lib/ai";
import { officeSnapshot } from "../src/lib/office";
import { stateAt } from "../src/lib/officeShared";

test("オフィス: ツールを書くような長いAIの呼び出しの間も、その社員は開発室にいる（呼んだ記録は終わってから書くため）", async () => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('袋づめ最終審判', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool')").run().lastInsertRowid);
  let done!: () => void;
  const call = tracked("claude-opus-5-5", "ツール作成", id, () => new Promise<void>((ok) => { done = ok; }));
  // 呼んでいる途中: 呼んだ記録（ai_calls）はまだないが、開発室でツールを作っている
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM ai_calls WHERE purpose = 'ツール作成'").get() as { n: number }).n, 0);
  const snap = officeSnapshot();
  const s = stateAt(snap.events, snap.now).anthropic;
  assert.deepEqual([s.room, s.doing, s.project, s.projectId], ["dev", "ツール作成", "袋づめ最終審判", id]);
  // 呼んだ回数・費用には数えない（終わって記録が書かれたときに数える）
  assert.ok(snap.events.filter((e) => e.member === "anthropic" && e.room === "dev").every((e) => e.talk && e.yen === 0));
  done();
  await call;
  assert.equal(ongoingCalls().length, 0);
  // 終わったら、途中の分は出ない（そのあとは呼んだ記録で開発室に3分いる）
  assert.ok(!officeSnapshot().events.some((e) => e.member === "anthropic" && e.doing === "ツール作成"));
});
