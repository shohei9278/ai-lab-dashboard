import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings } from "../src/lib/db";
import { devWaiting, getProject, prepareLp, routineFixTurn, routineTurnForNew } from "../src/lib/loop";
import { autoToolRoutine } from "../src/lib/toolRoutine";

// 通常案件のツールも、ルーティンに作ってもらう（11/28 に運営者が、交代の4つ目から、新しいツールは全部ルーティンにすると決めた）
// 直しは、作った担当がする（ルーティンが書いたツールはルーティン、AI が書いたツールは AI）

function configure() {
  process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01TOOLS/fire";
  process.env.CLAUDE_TOOL_ROUTINE_TOKEN = "routine-secret";
  process.env.LAB_TOOL_TOKEN = "x".repeat(40);
}
const addTool = (title: string, deep = 0) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, aim) VALUES (?, '学生', 'p', 's', 'h', 'r', 'idea', 'claude', 'tool', ?, 'useful')",
).run(title, deep).lastInsertRowid);
// ツールの版（tool_model は書いた担当）
const aiVersion = (id: number, model: string, version = 1) => db().prepare("INSERT INTO lp_versions (project_id, version, lp, tool_model) VALUES (?, ?, '{}', ?)").run(id, version, model);

test("通常案件のルーティン: 新しいツールは、AIの担当の数を見ずに、いつもルーティンに作ってもらう", () => {
  configure();
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  db().exec("DELETE FROM lp_versions; DELETE FROM approvals; DELETE FROM projects");
  const p = { id: 999999, kind: "tool" as const, deep: 0, lp: null, tool_maker: null };
  assert.equal(routineTurnForNew(p), true);
  // ルーティンが何件作っていても、AIの担当が0件でも、ルーティンのまま（前の交代の数え方はやめた）
  for (let i = 0; i < 3; i++) db().prepare("UPDATE projects SET tool_maker = 'claude-code' WHERE id = ?").run(addTool(`ルーティン${i}`));
  assert.equal(routineTurnForNew(p), true);
  // じっくり案件・作ったツールがある案件・LP → ここでは決めない
  assert.equal(routineTurnForNew({ ...p, deep: 1 }), false);
  assert.equal(routineTurnForNew({ ...p, lp: "{}" }), false);
  assert.equal(routineTurnForNew({ ...p, kind: "lp" }), false);
  // 設定でオフ・止めるスイッチ・ルーティンにつながっていない → AI が書く
  saveSettings({ toolRoutineNormal: false });
  assert.equal(routineTurnForNew(p), false);
  saveSettings({ toolRoutineNormal: true, killSwitch: true });
  assert.equal(routineTurnForNew(p), false);
  saveSettings({ killSwitch: false });
  delete process.env.CLAUDE_TOOL_ROUTINE_TOKEN;
  assert.equal(routineTurnForNew(p), false);
  // 一度ルーティンに作ってもらうと決めた案件は、設定やつながりが変わっても、ルーティンのまま（やり直したとき）
  assert.equal(routineTurnForNew({ ...p, tool_maker: "claude-code" }), true);
  saveSettings({ toolRoutineNormal: false });
  assert.equal(routineTurnForNew({ ...p, tool_maker: "claude-code" }), true);
  saveSettings({ toolRoutineNormal: true });
  configure();
  // いまの版が空でも、過去にツールの版がある案件は新しいツールではない（ルーティンにすると決めた案件でも）
  const had = addTool("過去に版がある");
  aiVersion(had, "claude-opus-5-5");
  assert.equal(routineTurnForNew({ ...p, id: had }), false);
  assert.equal(routineTurnForNew({ ...p, id: had, tool_maker: "claude-code" }), false);
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

test("通常案件のルーティン: 直しは、いまのツールを書いた担当がする（ルーティンが書いたものだけ、ルーティンに頼む）", () => {
  configure();
  db().exec("DELETE FROM lp_versions; DELETE FROM approvals; DELETE FROM projects");
  const byRoutine = addTool("ルーティンが書いた");
  aiVersion(byRoutine, "claude-code");
  const byAi = addTool("AI が書いた");
  aiVersion(byAi, "claude-sonnet-5-5");
  // AI が書いたあと、チェックで止まってルーティンが直した → いまのツールはルーティンが書いたもの
  const fixed = addTool("AI が書きルーティンが直した");
  aiVersion(fixed, "gpt-6.2-sol", 1);
  aiVersion(fixed, "claude-code", 2);
  // いちばん新しい版に担当の記録がなければ、前の版の担当にさかのぼらない（AI が直す）
  const unknown = addTool("新しい版の担当が分からない");
  aiVersion(unknown, "claude-code", 1);
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, tool_model) VALUES (?, 2, '{}', NULL)").run(unknown);
  const q = (id: number) => ({ id, kind: "tool" as const, deep: 0, lp: "{}" });
  assert.equal(routineFixTurn(q(byRoutine)), true);
  assert.equal(routineFixTurn(q(byAi)), false);
  assert.equal(routineFixTurn(q(fixed)), true);
  assert.equal(routineFixTurn(q(unknown)), false);
  // まだツールがない・じっくり案件（別の流れで、いつもルーティン）・LP → ここでは決めない
  assert.equal(routineFixTurn({ ...q(byRoutine), lp: null }), false);
  assert.equal(routineFixTurn({ ...q(byRoutine), deep: 1 }), false);
  assert.equal(routineFixTurn({ ...q(byRoutine), kind: "lp" }), false);
  // 設定でオフ・止めるスイッチ・ルーティンにつながっていない → AI が直す
  saveSettings({ toolRoutineNormal: false });
  assert.equal(routineFixTurn(q(byRoutine)), false);
  saveSettings({ toolRoutineNormal: true, killSwitch: true });
  assert.equal(routineFixTurn(q(byRoutine)), false);
  saveSettings({ killSwitch: false });
  delete process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL;
  assert.equal(routineFixTurn(q(byRoutine)), false);
  configure();
});

test("通常案件のルーティン: ルーティンが書いたツールを直す指示は、AIが書かずに開発待ちにし、ルーティンに頼む対象になる（最初は AI が作った案件でも）", async () => {
  configure();
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  db().exec("DELETE FROM lp_versions; DELETE FROM approvals; DELETE FROM projects");
  // 最初は AI（GPT）が作り、チェックで止まってルーティンが直した案件（tool_maker は空のまま）
  const id = addTool("AI が作りルーティンが直したツール");
  db().prepare("UPDATE projects SET lp = '{}', lp_version = 2, stage = 'lp' WHERE id = ?").run(id);
  aiVersion(id, "gpt-6.2-sol", 1);
  aiVersion(id, "claude-code", 2);
  // AIを呼ばずに試すため、前の設計書を置いておく
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'dev', '前', '前', 'done', ?)").run(id, JSON.stringify({ design: "## 一言で\n小さな計算", instruction: null }));
  await prepareLp(id, "ボタンの文言を短くする", { keepCore: true, byHuman: true });
  const dev = db().prepare("SELECT proposal, payload FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id) as { proposal: string; payload: string } | undefined;
  assert.ok(dev);
  assert.match(dev.proposal, /Claude Code で直す/);
  assert.equal((JSON.parse(dev.payload) as { instruction: string }).instruction, "ボタンの文言を短くする");
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM lp_versions WHERE project_id = ?").get(id) as { n: number }).n, 2, "AI は新しい版を書かない");
  assert.equal(getProject(id)!.tool_maker, null);
  // ルーティンに自動で頼むときに選ばれる（つながっていて、自動で頼む設定がオン）
  const calls: string[] = [];
  const n = await autoToolRoutine({ fetchImpl: async (url: string) => { calls.push(url); return new Response(JSON.stringify({ claude_code_session_url: "https://claude.ai/code/x" }), { status: 200 }); } });
  assert.equal(n, 1);
  assert.equal(calls.length, 1);
  assert.ok((db().prepare("SELECT routine_at FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id) as { routine_at: string | null }).routine_at);
  // 次のテストが案件を消せるように、この案件の記録を片付ける
  db().prepare("DELETE FROM events WHERE project_id = ?").run(id);
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
  // やり直しても（設計書づくりの失敗など）、ルーティンの番のまま開発待ちにする
  db().exec("DELETE FROM approvals WHERE status = 'pending'");
  process.env.ANTHROPIC_API_KEY = "k";
  process.env.OPENAI_API_KEY = "k";
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'dev', '前', '前', 'revised', ?)").run(id, JSON.stringify({ design: "## 一言で\n小さな計算", instruction: null }));
  await prepareLp(id, undefined, { auto: true });
  assert.ok(db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id));
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
