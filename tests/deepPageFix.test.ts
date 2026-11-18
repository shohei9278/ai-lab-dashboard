import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { fixInstruction, pageOnlyIssues } from "../src/lib/fixText";
import { autoFixPublish, devRequestText } from "../src/lib/loop";

const TOOL = "<button id=b>押す</button><script>document.getElementById('b').onclick=()=>{}</script>";
// 紹介ページまでできて、公開の判断待ちになっているじっくり案件（チェックの指摘つき）
const pendingPublish = (issues: string[]) => {
  const lp = JSON.stringify({ headline: "余白の重心検査", tool: { html: TOOL, shareText: "s" } });
  const id = Number(db().prepare(
    "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, aim, lp, lp_version) VALUES ('余白の重心検査', '学生', 'p', '目測ゲーム', 'h', 'r', 'lp', 'claude', 'tool', 1, '演出', 'spread', ?, 1)",
  ).run(lp).lastInsertRowid);
  // AIを呼ばずに試すため、前の設計書を置いておく
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'dev', '前', '前', 'approved', ?)").run(id, JSON.stringify({ design: "## 一言で\n目測ゲーム", instruction: null }));
  const a = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'publish', '公開', '理由', 'pending', ?)").run(id, JSON.stringify({ review: { ok: false, issues } })).lastInsertRowid);
  return { id, a };
};
const devWait = (id: number) => db().prepare("SELECT payload FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id) as { payload: string } | undefined;

test("チェックの指摘の指示文: ツールの案件では紹介ページの指摘に印を残し、LPでは外す", () => {
  const issues = ["デザイン: 見本カードの点線が見出しに重なる", "紹介ページ: 誇大な表現", "結果が出ない"];
  const tool = fixInstruction(issues, true);
  assert.match(tool, /^AIのチェックで見つかった次の問題だけを直すこと/);
  assert.match(tool, /1\. 紹介ページ: 見本カードの点線が見出しに重なる\n2\. 紹介ページ: 誇大な表現\n3\. 結果が出ない/);
  assert.match(fixInstruction(issues, false), /1\. 見本カードの点線が見出しに重なる\n2\. 誇大な表現\n3\. 結果が出ない/);
  assert.equal(pageOnlyIssues(issues), false);
  assert.equal(pageOnlyIssues(issues.slice(0, 2)), true);
  assert.equal(pageOnlyIssues([]), false);
});

test("じっくり案件（#62 で運営者が見つけた）: 指摘が紹介ページだけなら、開発待ちにせず、ツールは今のままで紹介ページだけを直す", async () => {
  const { id, a } = pendingPublish(["デザイン: 見本カードの点線が見出しに重なる"]);
  // 紹介ページを書くAIを呼ぶので、テストでは失敗で終わる（キーがない）。開発待ちにはならない
  await assert.rejects(autoFixPublish(a));
  assert.equal(devWait(id), undefined);
  const ev = db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'auto-fix'").get(id) as { message: string };
  assert.match(ev.message, /紹介ページだけ。ツールは今のまま/);
});

test("じっくり案件: ツールの指摘が混ざっていれば、開発待ちにする。依頼文で、紹介ページの指摘はツールで直さないと伝える", async () => {
  const { id, a } = pendingPublish(["デザイン: 見本カードの点線が見出しに重なる", "ボタンを押しても結果が出ない"]);
  await autoFixPublish(a);
  const w = devWait(id);
  assert.ok(w);
  const instruction = (JSON.parse(w.payload) as { instruction: string }).instruction;
  assert.match(instruction, /1\. 紹介ページ: 見本カードの点線/);
  const text = devRequestText(id, "## 一言で\n目測ゲーム", instruction);
  assert.match(text, /「紹介ページ:」で始まる指摘は、ツールではなくAIが書く紹介ページのもの/);
  // 紹介ページの指摘がない依頼には書かない
  assert.doesNotMatch(devRequestText(id, "d", "1. ボタンを押しても結果が出ない"), /「紹介ページ:」で始まる/);
});
