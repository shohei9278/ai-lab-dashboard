import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings } from "../src/lib/db";
import { devWaiting, getProject, prepareLp, routineTurnForNew } from "../src/lib/loop";

// 通常案件の新しいツールも、ツールを書く担当の交代の1つとしてルーティンに作ってもらう（運営者が決めた）

function configure() {
  process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01TOOLS/fire";
  process.env.CLAUDE_TOOL_ROUTINE_TOKEN = "routine-secret";
  process.env.LAB_TOOL_TOKEN = "x".repeat(40);
}
const addTool = (title: string, deep = 0) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, aim) VALUES (?, '学生', 'p', 's', 'h', 'r', 'idea', 'claude', 'tool', ?, 'useful')",
).run(title, deep).lastInsertRowid);
// AIが書いたツールの版（作り比べの数に入る）
const aiVersion = (id: number, model: string) => db().prepare("INSERT INTO lp_versions (project_id, version, lp, tool_model) VALUES (?, 1, '{}', ?)").run(id, model);

test("通常案件のルーティン: 交代の番は、ルーティンに作ってもらうと決めた数が、AIの担当の一番少ない数以下のとき", () => {
  configure();
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  db().exec("DELETE FROM lp_versions; DELETE FROM approvals; DELETE FROM projects");
  const p = { kind: "tool" as const, deep: 0, lp: null };
  // まだどれも作っていない → ルーティンが先
  assert.equal(routineTurnForNew(p), true);
  db().prepare("UPDATE projects SET tool_maker = 'claude-code' WHERE id = ?").run(addTool("ルーティン1"));
  assert.equal(routineTurnForNew(p), false, "AIの担当がまだ0件");
  aiVersion(addTool("opus"), "claude-opus-5-5");
  aiVersion(addTool("sonnet"), "claude-sonnet-5-5");
  assert.equal(routineTurnForNew(p), false, "GPT がまだ0件");
  aiVersion(addTool("gpt"), "gpt-5.6-sol");
  assert.equal(routineTurnForNew(p), true, "どれも1件になった");
  // じっくり案件・作ったツールがある案件・LP・設定でオフ・ルーティンがない → 番にしない
  assert.equal(routineTurnForNew({ ...p, deep: 1 }), false);
  assert.equal(routineTurnForNew({ ...p, lp: "{}" }), false);
  assert.equal(routineTurnForNew({ ...p, kind: "lp" }), false);
  saveSettings({ toolRoutineNormal: false });
  assert.equal(routineTurnForNew(p), false);
  saveSettings({ toolRoutineNormal: true });
  delete process.env.CLAUDE_TOOL_ROUTINE_TOKEN;
  assert.equal(routineTurnForNew(p), false);
  configure();
  // この仕組みを入れた日より前に作り始めた案件は数えない（前からの数で比べると、追いつくまでルーティンばかりになる）
  db().prepare("UPDATE projects SET created_at = '2026-11-01 00:00:00' WHERE title IN ('opus', 'sonnet', 'gpt')").run();
  assert.equal(routineTurnForNew(p), false, "比べるAIの数は0件に戻り、ルーティンは1件");
});

test("通常案件のルーティン: 番のときは、AIが書かずに開発待ちにし、じっくり案件の開発待ちの上限には数えない", async () => {
  configure();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  db().exec("DELETE FROM lp_versions; DELETE FROM approvals; DELETE FROM projects");
  const id = addTool("ふつうのツール");
  // AIを呼ばずに試すため、前の設計書を置いておく
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'dev', '前', '前', 'revised', ?)").run(id, JSON.stringify({ design: "## 一言で\n小さな計算", instruction: null }));
  await prepareLp(id, undefined, { auto: true });
  assert.equal(getProject(id)!.tool_maker, "claude-code");
  assert.equal(getProject(id)!.lp, null);
  const dev = db().prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id) as { proposal: string } | undefined;
  assert.ok(dev);
  assert.match(dev.proposal, /Claude Code で作る/);
  const ev = db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'dev-design' ORDER BY id DESC").get(id) as { message: string };
  assert.doesNotMatch(ev.message, /じっくり案件/);
  assert.equal(devWaiting(), 0, "じっくり案件の開発待ちの上限には数えない");
});
