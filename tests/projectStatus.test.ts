import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings, type ApprovalRow } from "../src/lib/db";
import { pendingByProject, resultNote, shownStage, waitStateOf } from "../src/lib/projectStatus";
import { STAGE_LABEL } from "../src/lib/loop";

// 案件の一覧と案件の画面の様子（11/28 に運営者が、ステータスが分かりづらいと言った）

function configure() {
  process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01TOOLS/fire";
  process.env.CLAUDE_TOOL_ROUTINE_TOKEN = "routine-secret";
  process.env.LAB_TOOL_TOKEN = "x".repeat(40);
}
const dev = (extra: Partial<ApprovalRow> = {}) => ({ kind: "dev", status: "pending", routine_at: null, routine_tries: 0, routine_url: null, ...extra }) as ApprovalRow;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

test("案件の様子: 段階の名前は「集客中」「集客なし」", () => {
  assert.equal(STAGE_LABEL.live, "集客中");
  assert.equal(STAGE_LABEL.hold, "集客なし");
});

test("案件の様子: 開発待ちがある「アイデア」の案件は「作成」として見せる", () => {
  assert.equal(shownStage({ stage: "idea" }, [dev()]), "lp");
  assert.equal(shownStage({ stage: "idea" }, [{ kind: "idea" } as ApprovalRow]), "idea");
  assert.equal(shownStage({ stage: "idea" }, []), "idea");
  assert.equal(shownStage({ stage: "live" }, [dev()]), "live");
});

test("案件の様子: ルーティンに自動で頼む開発待ちはAIの作業中、それ以外は人の判断待ち", () => {
  configure();
  saveSettings({ toolRoutineAuto: true, killSwitch: false });
  const now = Date.now();
  assert.equal(waitStateOf([], now), null);
  assert.deepEqual(waitStateOf([dev()], now), { kind: "ai", working: false });
  assert.deepEqual(waitStateOf([dev({ routine_at: iso(now - 600_000), routine_tries: 1 })], now), { kind: "ai", working: true });
  // 人の判断が要るもの（公開の承認・2回頼んでも入らなかった開発待ち）が1つでもあれば、人の判断待ち
  assert.deepEqual(waitStateOf([dev(), { ...dev(), kind: "publish" } as ApprovalRow], now), { kind: "human" });
  assert.deepEqual(waitStateOf([dev({ routine_at: iso(now - 4 * 3_600_000), routine_tries: 2 })], now), { kind: "human" });
  // 自動で頼む設定がオフなら、開発待ちも人の判断待ち
  saveSettings({ toolRoutineAuto: false });
  assert.deepEqual(waitStateOf([dev()], now), { kind: "human" });
  saveSettings({ toolRoutineAuto: true });
});

test("案件の様子: 終わった案件の公開ページ（継続は公開中・撤退は公開終了・見送りは公開していたかで分ける）", () => {
  assert.equal(resultNote({ stage: "continued", public_slug: "a" }), "公開中");
  assert.equal(resultNote({ stage: "killed", public_slug: "a" }), "公開終了");
  assert.equal(resultNote({ stage: "rejected", public_slug: "a" }), "公開終了");
  assert.equal(resultNote({ stage: "rejected", public_slug: null }), "公開していない");
  assert.equal(resultNote({ stage: "live", public_slug: "a" }), null);
});

test("案件の様子: 承認待ちを案件ごとにまとめる（返事をしたものは入れない）", () => {
  db().exec("DELETE FROM events; DELETE FROM approvals; DELETE FROM lp_versions; DELETE FROM projects");
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t', 't', 'p', 's', 'h', 'r', 'idea', 'claude', 'tool')").run().lastInsertRowid);
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason) VALUES (?, 'dev', 'p', 'r')").run(id);
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status) VALUES (?, 'publish', 'p', 'r', 'approved')").run(id);
  const m = pendingByProject();
  assert.deepEqual(m.get(id)?.map((a) => a.kind), ["dev"]);
});
