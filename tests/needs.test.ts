import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings } from "../src/lib/db";
import { deepAllowance } from "../src/lib/deep";
import { getProject, markNeedsDone } from "../src/lib/loop";
import { needsGroups, needsOf, needsProjects, needsWaiting } from "../src/lib/needs";
import { waitingItems } from "../src/lib/overview";

const add = (needs: unknown, extra: { stage?: string; needs_done?: number; demo?: number } = {}) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, needs, needs_done, demo) VALUES (?, 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', 1, '作り込み', ?, ?, ?)",
).run(`案件${Math.random()}`, extra.stage ?? "idea", needs === null ? null : JSON.stringify(needs), extra.needs_done ?? 0, extra.demo ?? 0).lastInsertRowid);

test("人の作業待ち: 要るものは決めた種類だけ、3つまでそろえる。初めの上限は5件", () => {
  assert.deepEqual(needsOf([
    { kind: "store", what: " みんなの投票の結果 ", why: "ランキングを見せる" },
    { kind: "constructor", what: "x" },
    { kind: "ai", what: "" },
    { kind: "api", what: "天気", why: 3 },
    { kind: "asset", what: "効果音" },
    { kind: "other", what: "4つ目" },
  ]), [
    { kind: "store", what: "みんなの投票の結果", why: "ランキングを見せる" },
    { kind: "api", what: "天気", why: "" },
    { kind: "asset", what: "効果音", why: "" },
  ]);
  assert.deepEqual(needsOf("store"), []);
  assert.equal(getSettings().needsWaitMax, 5);
});

test("人の作業待ち: 数え方・種類ごとのまとめ。止まっている案件や、じっくり案件の週の上限には数えない", () => {
  const before = deepAllowance();
  const a = add([{ kind: "store", what: "みんなの投票", why: "ランキング" }]);
  const b = add([{ kind: "store", what: "みんなの結果" }, { kind: "ai", what: "AIが名前を付ける" }]);
  add([{ kind: "store", what: "済んだもの" }], { needs_done: 1 });
  add([{ kind: "store", what: "デモ" }], { demo: 1 });
  assert.equal(needsWaiting(), 2);
  const groups = needsGroups(needsProjects().filter((p) => !p.demo));
  assert.deepEqual(groups.map((g) => [g.kind, g.projects.map((p) => p.id)]), [["store", [a, b]], ["ai", [b]]]);
  // 「作業が途中で止まった」には入れない
  assert.ok(!waitingItems().some((w) => w.kind === "stuck" && (w.projectId === a || w.projectId === b)));
  // 待っている案件は、じっくり案件の週の上限に数えない（「済み」にして作り始めた1件だけ数える）
  assert.equal(deepAllowance(), Math.max(0, before - 1));
});

test("人の作業待ち: 「済み」にすると作り始める（待っていない案件では使えない）", async () => {
  const id = add([{ kind: "ai", what: "AIが名前を付ける" }]);
  assert.throws(() => markNeedsDone(add(null)), /人の作業待ちの案件ではありません/);
  // 作り始めると、設計書を書くAIを呼ぶ（テストではキーがないので失敗で終わる）
  await markNeedsDone(id).catch(() => undefined);
  assert.equal(getProject(id)!.needs_done, 1);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'needs-done'").get(id));
  assert.equal(needsProjects().some((p) => p.id === id), false);
  assert.throws(() => markNeedsDone(id), /人の作業待ちの案件ではありません/);
});
