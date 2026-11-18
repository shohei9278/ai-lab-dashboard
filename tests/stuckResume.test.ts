import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { abandonStuck, getProject, isStuck, resumeNote, resumePlan, resumeStuck } from "../src/lib/loop";
import { waitingItems } from "../src/lib/overview";

const TOOL = "<button id=b>押す</button><script>document.getElementById('b').onclick=()=>{}</script>";
// 第1版までできた、まだ公開していないじっくり案件（判断待ちはない）
const madeDeep = (publicSlug: string | null = null) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, aim, lp, lp_version, public_slug, public_version) VALUES ('余白の重心検査', '学生', 'p', '目測ゲーム', 'h', 'r', 'lp', 'claude', 'tool', 1, '演出', 'spread', ?, 1, ?, ?)",
).run(JSON.stringify({ headline: "h", tool: { html: TOOL, shareText: "s" } }), publicSlug, publicSlug ? 1 : null).lastInsertRowid);
const approval = (id: number, kind: string, status: string, payload: unknown, comment: string | null = null) =>
  Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload, comment) VALUES (?, ?, ?, '理由', ?, ?, ?)").run(id, kind, kind === "dev" ? "「余白の重心検査」のツールを Claude Code で直す" : "公開", status, JSON.stringify(payload), comment).lastInsertRowid);
const pending = (id: number) => db().prepare("SELECT * FROM approvals WHERE project_id = ? AND status = 'pending'").all(id) as { kind: string; proposal: string; payload: string; reason: string }[];

test("途中で止まった案件（#62 で運営者が見つけた）: 版があっても、判断待ちがなく作業中でもなければ、止まった案件として出す", () => {
  const id = madeDeep();
  approval(id, "dev", "approved", { design: "設計", instruction: "1. 紹介ページ: 重なり" });
  assert.equal(isStuck(getProject(id)!), true);
  assert.ok(waitingItems().some((w) => w.kind === "stuck" && w.projectId === id));
  // 判断待ちがあれば止まっていない
  const other = madeDeep();
  approval(other, "publish", "pending", {});
  assert.equal(isStuck(getProject(other)!), false);
  assert.ok(!waitingItems().some((w) => w.kind === "stuck" && w.projectId === other));
});

test("途中で止まった案件: ツールの取り込みで止まったら、AIを呼ばずに、同じ内容の開発待ちに戻す", async () => {
  const id = madeDeep();
  approval(id, "dev", "approved", { design: "設計", instruction: "1. 紹介ページ: 重なり" });
  await resumeStuck(id);
  const p = pending(id);
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, "dev");
  assert.match(p[0].proposal, /Claude Code で直す/);
  assert.deepEqual(JSON.parse(p[0].payload), { design: "設計", instruction: "1. 紹介ページ: 重なり" });
  assert.match(p[0].reason, /同じHTMLを、もう一度/);
  assert.equal(isStuck(getProject(id)!), false);
  await assert.rejects(resumeStuck(id), /途中で止まった案件だけ/);
});

test("途中で止まった案件: 修正の途中で止まったら、同じ指示で直し直す（紹介ページだけの指摘なら、ツールは今のまま）", async () => {
  const id = madeDeep();
  approval(id, "publish", "revised", { review: { ok: false, issues: ["デザイン: 重なり"] } }, "AIのチェックで見つかった次の問題だけを直すこと。\n1. 紹介ページ: 重なり");
  // 紹介ページを書くAIを呼ぶので、テストでは失敗で終わる（キーがない）。開発待ちにはならない
  await assert.rejects(resumeStuck(id));
  assert.equal(pending(id).length, 0);
  const ev = db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'resume'").get(id) as { message: string };
  assert.match(ev.message, /同じ指示でやり直します: AIのチェックで/);
});

test("途中で止まった案件: 公開したことのある案件は、見送れない（公開中のページとずれるため）。まだなら見送れる", () => {
  const published = madeDeep("p999");
  assert.throws(() => abandonStuck(published, ""), /公開したことのある案件は/);
  const fresh = madeDeep();
  abandonStuck(fresh, "");
  assert.equal(getProject(fresh)!.stage, "rejected");
});

test("途中で止まった案件（PR #94 の ai-review の指摘）: 何が止まったかと、やり直すと何が起きるか（AIを呼ぶか）を、やり直しと同じ判定で出す", () => {
  // ツールの取り込みで止まった: 開発待ちに戻すだけ（AIは呼ばない）
  const up = madeDeep();
  approval(up, "dev", "approved", { design: "設計" });
  const pu = resumePlan(getProject(up)!);
  assert.equal(pu.kind, "upload");
  assert.equal(pu.ai, false);
  assert.match(pu.stopped, /取り込み/);
  assert.match(pu.then, /同じHTMLを、もう一度入れて/);
  // 紹介ページだけの指摘の修正で止まった: 紹介ページだけをAIが直し直す（AIを呼ぶ）。止まった指示の頭を見せる
  const page = madeDeep();
  approval(page, "publish", "revised", { review: { ok: false, issues: ["デザイン: 重なり"] } }, "AIのチェックで見つかった次の問題だけを直すこと。\n1. 紹介ページ: 重なり");
  const pp = resumePlan(getProject(page)!);
  assert.equal(pp.kind, "revise");
  assert.equal(pp.ai, true);
  assert.equal(pp.keepTool, true);
  assert.match(pp.stopped, /止まった指示: 「1\. 紹介ページ: 重なり」/);
  assert.match(pp.then, /紹介ページだけを直し直します/);
  // ツールの指摘の修正で止まった（じっくり案件）: 前の設計書があれば、開発待ちを出すだけ（AIは呼ばない）
  const tool = madeDeep();
  approval(tool, "dev", "approved", { design: "設計" });
  approval(tool, "publish", "revised", { review: { ok: false, issues: ["結果が出ない"] } }, "1. 結果が出ない");
  const pt = resumePlan(getProject(tool)!);
  assert.equal(pt.kind, "revise");
  assert.equal(pt.ai, false);
  assert.match(pt.then, /開発待ち（Claude Code で直す）.*AIは呼びません/);
  // 記録から分からない: 今の版をもとに作り直す（設計書がなければ、AIが設計書を書く）
  const other = madeDeep();
  const po = resumePlan(getProject(other)!);
  assert.equal(po.kind, "rebuild");
  assert.equal(po.ai, true);
  assert.match(po.stopped, /何の途中だったかは記録から分かりません/);
  // 画面には説明だけを渡す。止まっていなければ出さない
  assert.deepEqual(Object.keys(resumeNote(getProject(page)!)!).sort(), ["stopped", "then"]);
  approval(other, "publish", "pending", {});
  assert.equal(resumeNote(getProject(other)!), null);
});
