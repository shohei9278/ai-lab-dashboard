import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { decide, getProject, staticToolIssues, startDevUpload } from "../src/lib/loop";
import { withToolAi } from "../src/lib/publish";
import { aiAllowed, aiEverApproved, aiSpecFor, aiSpecPending, approveAiSpec, approvedAiSpec, currentAiDigest, replaceAiSpec } from "../src/lib/toolAi";
import { takeAiScript } from "../lp-site/src/lp/htmlDom";
import { normalizeLp } from "../lp-site/src/lp/content";
import { TOOL_AI_INPUT_MAX, TOOL_AI_INSTRUCTION_MAX, TOOL_AI_OUTPUT_MAX, toolAiLimitsOf, toolAiSpecOf, usesToolAi } from "../lp-site/src/lp/toolAi";

// その場で AI を呼ぶツールの許可（docs/design-tool-limits.md の「共通の作り」と ③）

const spec = { instruction: "入力された名前に、やさしいあだ名を1つ付ける", inputMax: 40, outputMax: 80 };
const html = '<div id="a"></div><script>window.labAi && window.labAi.ask("x")</script>';
const aiNeeds = JSON.stringify([{ kind: "ai", what: "あだ名を付ける", why: "入力ごとに変えるため" }]);

function addProject(opts: { needs?: string | null; needsDone?: number; html?: string } = {}): number {
  const lp = opts.html === undefined ? null : JSON.stringify({ headline: "h", tool: { html: opts.html, shareText: "s" } });
  return Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, needs, needs_done, lp) VALUES ('t', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool', ?, ?, ?)")
    .run(opts.needs ?? null, opts.needsDone ?? 0, lp).lastInsertRowid);
}
const approve = (id: number) => approveAiSpec(getProject(id)!, currentAiDigest(getProject(id)!) ?? "");
const addDev = (projectId: number) => Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, payload) VALUES (?, 'dev', 'p', 'r', '{}')").run(projectId).lastInsertRowid);

test("AIへの指示の形: 指示・入力の上限・答えの上限がそろっていれば使い、前後の空白は落とす。だめなら理由", () => {
  assert.deepEqual(toolAiSpecOf({ ...spec, instruction: `  ${spec.instruction}\n` }), spec);
  for (const bad of [null, [], "x", { ...spec, instruction: " " }, { ...spec, instruction: "x".repeat(TOOL_AI_INSTRUCTION_MAX + 1) }, { ...spec, inputMax: 0 }, { ...spec, inputMax: TOOL_AI_INPUT_MAX + 1 }, { ...spec, inputMax: 1.5 }, { ...spec, outputMax: TOOL_AI_OUTPUT_MAX + 1 }, { ...spec, outputMax: "80" }]) {
    assert.equal(typeof toolAiSpecOf(bad), "string", JSON.stringify(bad));
  }
  // 画面に渡すのは長さの上限だけ（指示の本文は入れない）
  assert.deepEqual(toolAiLimitsOf(spec), { inputMax: 40, outputMax: 80 });
  assert.equal(toolAiLimitsOf({ inputMax: 40 }), undefined);
});

test("AIへの指示の取り出し: lab-ai の script だけを除き、ほかは1文字も変えない。2つある・type が違うときは理由", () => {
  const tag = `<script type="application/json" id="lab-ai">${JSON.stringify(spec)}</script>`;
  const r = takeAiScript(`${html}\n${tag}\n`);
  assert.equal(r.html, `${html}\n\n`);
  assert.deepEqual(JSON.parse(r.json!), spec);
  assert.deepEqual(takeAiScript(html), { html, json: null });
  assert.ok(takeAiScript(tag + tag).error);
  assert.ok(takeAiScript('<script id="lab-ai">{}</script>').error);
});

test("機械のチェック: 許していない案件で window.labAi を使うと止める。許しても、今の禁止の項目は残す", () => {
  assert.equal(usesToolAi(html), true);
  assert.ok(staticToolIssues(html).some((x) => x.includes("labAi")));
  assert.deepEqual(staticToolIssues(html, false, { ai: true }), []);
  const issues = staticToolIssues(`${html}<script>alert(1);fetch("/x")</script>`, false, { ai: true });
  assert.ok(issues.some((x) => x.includes("alert")));
  assert.ok(issues.some((x) => x.includes("通信")));
});

test("使ってよい案件: その場で AI が要る案件を、人が「済み」にしたときだけ", () => {
  assert.equal(aiAllowed({ needs: aiNeeds, needs_done: 1 }), true);
  assert.equal(aiAllowed({ needs: aiNeeds, needs_done: 0 }), false);
  assert.equal(aiAllowed({ needs: JSON.stringify([{ kind: "store", what: "投票", why: "" }]), needs_done: 1 }), false);
  assert.equal(aiAllowed({ needs: null, needs_done: 1 }), false);
  assert.equal(aiAllowed({ needs: "{", needs_done: 1 }), false);
});

test("承認: 人が公開を承認したときに、今のコードと指示の組み合わせを承認する。コードか指示が変われば承認し直す", () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  replaceAiSpec(id, html, spec);
  assert.equal(aiSpecPending(getProject(id)!), true);
  assert.equal(approvedAiSpec(id, html), undefined);
  assert.equal(approveAiSpec(getProject(id)!, "違う印"), false);
  assert.equal(approve(id), true);
  assert.deepEqual(approvedAiSpec(id, html), spec);
  assert.equal(aiSpecPending(getProject(id)!), false);
  assert.equal(aiEverApproved(id), true);
  // 同じコードに同じ指示を入れ直しても、承認は残る
  replaceAiSpec(id, html, spec);
  assert.deepEqual(approvedAiSpec(id, html), spec);
  // 指示が変われば承認し直す。戻すと、前の承認も戻る
  const undo = replaceAiSpec(id, html, { ...spec, outputMax: 60 });
  assert.equal(approvedAiSpec(id, html), undefined);
  undo();
  assert.deepEqual(approvedAiSpec(id, html), spec);
  // コードが変われば、前の承認は引き継がない
  assert.equal(approvedAiSpec(id, `${html} `), undefined);
  // 使ってよい案件でなければ、承認しない
  const other = addProject({ needs: aiNeeds, needsDone: 0, html });
  replaceAiSpec(other, html, spec);
  assert.equal(approve(other), false);
  assert.equal(aiSpecFor(other, html)?.approved, false);
});

test("公開する中身: 承認した指示だけを入れ、LP の中身に紛れた ai は外す。画面に読むときは、指示の本文を落とす", () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  const content = { headline: "h", tool: { html, shareText: "s", ai: { instruction: "紛れた指示", inputMax: 500, outputMax: 600 } } };
  assert.equal(withToolAi(getProject(id)!, content).tool.ai, undefined);
  replaceAiSpec(id, html, spec);
  assert.equal(withToolAi(getProject(id)!, content).tool.ai, undefined);
  approve(id);
  assert.deepEqual(withToolAi(getProject(id)!, content).tool.ai, spec);
  // 人の作業待ちに戻された案件（使ってよくない）は、承認があっても入れない
  db().prepare("UPDATE projects SET needs_done = 0 WHERE id = ?").run(id);
  assert.equal(withToolAi(getProject(id)!, content).tool.ai, undefined);
  // 公開サイトが読むときは、長さの上限だけを残す
  const lp = normalizeLp({ headline: "h", subheadline: "s", cta: "c", features: [], faq: [], tool: { html, shareText: "s", ai: spec } });
  assert.deepEqual(lp.tool?.ai, { inputMax: 40, outputMax: 80 });
});

test("ツールを入れる: 許されていない案件には AIへの指示を入れられない。許された案件で labAi を使うなら指示が要る。形が違えば理由を返す", () => {
  const tag = (v: unknown) => `<script type="application/json" id="lab-ai">${JSON.stringify(v)}</script>`;
  const denied = addProject({ needs: null, html: "<p>x</p><script></script>" });
  assert.throws(() => startDevUpload(addDev(denied), `${html}${tag(spec)}`), /許されていない/);
  // 許されていない案件では、指示を添えなくても labAi は止める
  assert.throws(() => startDevUpload(addDev(denied), html), /labAi/);
  const allowed = addProject({ needs: aiNeeds, needsDone: 1, html: "<p>x</p><script></script>" });
  assert.throws(() => startDevUpload(addDev(allowed), html), /lab-ai/);
  assert.throws(() => startDevUpload(addDev(allowed), `${html}${tag({ ...spec, inputMax: 0 })}`), /inputMax/);
  assert.throws(() => startDevUpload(addDev(allowed), `${html}<script type="application/json" id="lab-ai">{</script>`), /JSON/);
  // 入れられなかったので、指示は残っていない
  assert.equal(aiSpecFor(allowed, html), null);
});

test("承認の印: カードで見た組み合わせと今のものが違えば、公開の承認を断り、承認リクエストは残す（PR #240 の ai-review の指摘）", async () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  replaceAiSpec(id, html, spec);
  const seen = currentAiDigest(getProject(id)!)!;
  // カードを開いたあとに、指示が差し替わった
  replaceAiSpec(id, html, { ...spec, instruction: "別の指示" });
  const ap = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, payload) VALUES (?, 'publish', 'p', 'r', '{}')").run(id).lastInsertRowid);
  await assert.rejects(decide(ap, "approve", undefined, { aiDigest: seen }), /変わりました/);
  await assert.rejects(decide(ap, "approve"), /変わりました/);
  assert.equal((db().prepare("SELECT status FROM approvals WHERE id = ?").get(ap) as { status: string }).status, "pending");
  assert.equal(aiSpecFor(id, html)?.approved, false);
});

test("承認したことがある印は、指示を入れ直して承認の印が消えても残る（自動改善の止めに使う。PR #240 の ai-review の指摘）", () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  replaceAiSpec(id, html, spec);
  assert.equal(aiEverApproved(id), false);
  approve(id);
  replaceAiSpec(id, html, { ...spec, outputMax: 50 });
  assert.equal(approvedAiSpec(id, html), undefined);
  assert.equal(aiEverApproved(id), true);
});

test("取り込みの失敗で戻すのは、自分が書いた指示がまだ残っているときだけ（PR #240 の ai-review の指摘）", () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  const undoFirst = replaceAiSpec(id, html, spec);
  // 先の取り込みが終わる前に、別の取り込みが新しい指示を入れた
  replaceAiSpec(id, html, { ...spec, outputMax: 70 });
  undoFirst();
  assert.equal(aiSpecFor(id, html)?.spec.outputMax, 70);
  // 自分が消したあとに別の取り込みが入れた指示も、消さない
  const undoDelete = replaceAiSpec(id, html, null);
  replaceAiSpec(id, html, spec);
  undoDelete();
  assert.deepEqual(aiSpecFor(id, html)?.spec, spec);
});

test("公開する中身: ツールの形がおかしくても、紛れた ai は外す（PR #240 の ai-review の指摘）", () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  const out = withToolAi(getProject(id)!, { headline: "h", tool: { html: 1, ai: { instruction: "紛れた指示", inputMax: 1, outputMax: 1 } } });
  assert.deepEqual(out.tool, { html: 1 });
});

test("承認の印: 印が送られてきたら、今の指示がなくても・承認済みでも照合する（PR #240 の ai-review の指摘）", async () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  replaceAiSpec(id, html, spec);
  const seen = currentAiDigest(getProject(id)!)!;
  // カードを開いたあとに、指示のないコードに差し替わった
  db().prepare("UPDATE projects SET lp = ? WHERE id = ?").run(JSON.stringify({ headline: "h", tool: { html: "<p>no ai</p><script></script>", shareText: "s" } }), id);
  const ap = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, payload) VALUES (?, 'publish', 'p', 'r', '{}')").run(id).lastInsertRowid);
  await assert.rejects(decide(ap, "approve", undefined, { aiDigest: seen }), /変わりました/);
  assert.equal((db().prepare("SELECT status FROM approvals WHERE id = ?").get(ap) as { status: string }).status, "pending");
});

test("取り込みの失敗で戻すとき: 同じ指示を書いた別の取り込みや、そのあとの承認も消さない（PR #240 の ai-review の指摘）", () => {
  const id = addProject({ needs: aiNeeds, needsDone: 1, html });
  const undoFirst = replaceAiSpec(id, html, spec);
  replaceAiSpec(id, html, spec);
  approve(id);
  undoFirst();
  assert.deepEqual(approvedAiSpec(id, html), spec);
  // 誰も書き換えていなければ、戻す
  const other = addProject({ needs: aiNeeds, needsDone: 1, html });
  const undo = replaceAiSpec(other, html, spec);
  undo();
  assert.equal(aiSpecFor(other, html), null);
});
