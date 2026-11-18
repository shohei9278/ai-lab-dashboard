import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings } from "../src/lib/db";
import { deepAllowance } from "../src/lib/deep";
import { devRequestText, getProject, markNeedsDone } from "../src/lib/loop";
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

test("人の作業待ち（PR #91 の2回目の ai-review の指摘）: 長く待ってから作り始めたものは、作った日ではなく「済み」にした日から週の上限に数える", () => {
  const before = deepAllowance();
  const old = add([{ kind: "asset", what: "効果音" }], { needs_done: 1 });
  db().prepare("UPDATE projects SET created_at = datetime('now', '-20 days'), needs_done_at = datetime('now') WHERE id = ?").run(old);
  assert.equal(deepAllowance(), Math.max(0, before - 1));
  db().prepare("UPDATE projects SET needs_done_at = datetime('now', '-8 days') WHERE id = ?").run(old);
  assert.equal(deepAllowance(), before);
});

test("人の作業待ち（PR #91 の ai-review の指摘）: まだない仕組み（保存の場所・API・AI）が要る案件は、まだ「済み」にできない", () => {
  const id = add([{ kind: "asset", what: "効果音" }, { kind: "ai", what: "AIが名前を付ける" }]);
  assert.throws(() => markNeedsDone(id), /まだない仕組み（その場でAIを呼ぶ）が要るため/);
  assert.equal(getProject(id)!.needs_done, 0);
});

test("人の作業待ち: 「済み」にすると、毎回承認の設定でもアイデアの承認を挟まずに作り始める。失敗したら人の作業待ちに戻す", async () => {
  const id = add([{ kind: "asset", what: "効果音を用意する" }]);
  db().prepare("UPDATE projects SET mode = 'manual' WHERE id = ?").run(id);
  assert.throws(() => markNeedsDone(add(null)), /人の作業待ちの案件ではありません/);
  // 作り始めると、設計書を書くAIを呼ぶ（テストではキーがないので失敗で終わる）。アイデアの承認は作らない
  const job = markNeedsDone(id);
  assert.equal(getProject(id)!.needs_done, 1);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'needs-done'").get(id));
  await assert.rejects(job);
  assert.equal(db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'idea'").get(id), undefined);
  // 失敗したので、人の作業待ちに戻っている（もう一度「済み」にできる）
  assert.equal(getProject(id)!.needs_done, 0);
  assert.equal(getProject(id)!.needs_done_at, null);
  assert.ok(needsProjects().some((p) => p.id === id));
  // 失敗の詳しい内容は、来訪者に伏せられる種類で残す
  assert.ok(db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'needs-error'").get(id));
});

test("人の作業待ち（PR #91 の3回目の ai-review の指摘）: 「済み」にした要るものは、Claude Code への依頼文に入る", () => {
  const id = add([{ kind: "asset", what: "効果音を3つ", why: "当たりの手ざわり" }], { needs_done: 1 });
  const text = devRequestText(id, "## 一言で\n音が鳴る", null);
  assert.match(text, /## 人が用意したもの/);
  assert.match(text, /素材: 効果音を3つ（当たりの手ざわり）/);
  assert.match(text, /作る前に運営者に聞く/);
  // まだ「済み」でない・要るものがない案件には入れない
  assert.doesNotMatch(devRequestText(add([{ kind: "asset", what: "x" }]), "d", null), /人が用意したもの/);
  assert.doesNotMatch(devRequestText(add(null), "d", null), /人が用意したもの/);
});
