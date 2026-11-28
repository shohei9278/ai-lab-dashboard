import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings } from "../src/lib/db";
import { allToolsDeep, deepOf, devWaiting, getProject, insertProject, type Idea } from "../src/lib/loop";

// ルーティンにつながっているときは、ツールの案件を全部じっくり案件として作る（11/28 に運営者が決めた）

function configure() {
  process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01TOOLS/fire";
  process.env.CLAUDE_TOOL_ROUTINE_TOKEN = "routine-secret";
  process.env.LAB_TOOL_TOKEN = "x".repeat(40);
}
const unconfigure = () => { delete process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL; };
const base = { aim: "useful", genre: "計算", title: "t", target: "学生", problem: "p", solution: "s", hypothesis: "h", reason: "r", confidence: 0.5 };
const tool = (extra: Partial<Idea> = {}) => ({ ...base, kind: "tool", ...extra }) as unknown as Idea;
const lp = () => ({ ...base, aim: "demand", kind: "lp" }) as unknown as Idea;
const choice = { mode: "manual" as const, why: "設定", confidence: null };

test("全部じっくり: ルーティンにつながっていて設定がオン・止めるスイッチが切れているときだけ", () => {
  configure();
  saveSettings({ toolRoutineNormal: true, killSwitch: false });
  assert.equal(allToolsDeep(), true);
  saveSettings({ toolRoutineNormal: false });
  assert.equal(allToolsDeep(), false);
  saveSettings({ toolRoutineNormal: true, killSwitch: true });
  assert.equal(allToolsDeep(), false);
  saveSettings({ killSwitch: false });
  unconfigure();
  assert.equal(allToolsDeep(), false);
  configure();
});

test("全部じっくり: 作り込む所が書かれていない tool の案もじっくり案件にする。LP はしない。全部じっくりでないときは、書かれた案だけ", () => {
  assert.equal(deepOf(tool(), true), true);
  assert.equal(deepOf(tool({ deep: "演出を作り込む" }), true), true);
  assert.equal(deepOf(lp(), true), false);
  assert.equal(deepOf(tool(), false), false);
  assert.equal(deepOf(tool({ deep: "演出を作り込む" }), false), true);
  assert.equal(deepOf(tool({ deep: "  " }), false), false);
});

test("全部じっくり: 案件を作るとき、tool はじっくり案件にし、要るデータ・まだない仕組みも残す（作り込む所がなければ空）", () => {
  configure();
  saveSettings({ toolRoutineNormal: true, killSwitch: false });
  db().exec("DELETE FROM events; DELETE FROM approvals; DELETE FROM lp_versions; DELETE FROM projects");
  const plain = getProject(insertProject(tool(), "", choice, "manual", "claude-opus-5-5"))!;
  assert.equal(plain.deep, 1);
  assert.equal(plain.deep_plan, null);
  const data = getProject(insertProject(tool({ deep_data: "全国の市町村の一覧（1,700件）", needs: [{ kind: "store", what: "保存", why: "記録を残す" }] } as Partial<Idea>), "", choice, "manual", "claude-opus-5-5"))!;
  assert.equal(data.deep, 1);
  assert.match(data.deep_need ?? "", /市町村/);
  assert.match(data.needs ?? "", /store/);
  assert.equal(getProject(insertProject(lp(), "", choice, "manual", "claude-opus-5-5"))!.deep, 0);
  // 全部じっくりでないときは、これまでどおり（作り込む所が書かれた案だけ。要るデータも、じっくり案件のときだけ）
  unconfigure();
  const off = getProject(insertProject(tool({ deep_data: "一覧" } as Partial<Idea>), "", choice, "manual", "claude-opus-5-5"))!;
  assert.equal(off.deep, 0);
  assert.equal(off.deep_need, null);
  configure();
});

test("全部じっくり: 開発待ちは、通常案件の分も数える（全部じっくりでないときは、じっくり案件だけ）", () => {
  configure();
  saveSettings({ toolRoutineNormal: true, killSwitch: false });
  db().exec("DELETE FROM events; DELETE FROM approvals; DELETE FROM lp_versions; DELETE FROM projects");
  const normal = insertProject(tool(), "", choice, "manual", "claude-opus-5-5");
  db().prepare("UPDATE projects SET deep = 0 WHERE id = ?").run(normal);
  const deep = insertProject(tool({ deep: "作り込む" }), "", choice, "manual", "claude-opus-5-5");
  for (const id of [normal, deep]) db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason) VALUES (?, 'dev', 'p', 'r')").run(id);
  assert.equal(devWaiting(), 2);
  assert.equal(devWaiting(false), 1);
});
