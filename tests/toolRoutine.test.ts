import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings, type ApprovalRow } from "../src/lib/db";
import { autoToolRoutine, hasTool, labTokenOk, startToolRoutine, toolRoutineConfigured, toolRoutineText, toolRoutineView } from "../src/lib/toolRoutine";
import { GET, POST } from "../src/app/api/tool-jobs/[id]/route";

// 開発待ちのじっくり案件を、クラウドの Claude Code（ルーティン「案件のツールを作る」）に頼む（運営者が決めた。頼む数は設定で決める）

const FIRE = "https://api.anthropic.com/v1/claude_code/routines/trig_01TOOLS/fire";
const LAB = "x".repeat(40);
function configure() {
  process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL = FIRE;
  process.env.CLAUDE_TOOL_ROUTINE_TOKEN = "routine-secret";
  process.env.LAB_TOOL_TOKEN = LAB;
}
function devCase(title = "雪玉密度鑑定所", instruction: string | null = null): { projectId: number; approvalId: number } {
  const projectId = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep) VALUES (?, 't', 'p', 's', 'h', 'r', 'idea', 'claude', 'tool', 1)").run(title).lastInsertRowid);
  const approvalId = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, payload) VALUES (?, 'dev', '作る', '設計書を書いた', ?)").run(projectId, JSON.stringify({ design: "## 一言で\n雪玉を固める", instruction })).lastInsertRowid);
  return { projectId, approvalId };
}
const row = (id: number) => db().prepare("SELECT * FROM approvals WHERE id = ?").get(id) as ApprovalRow;
const okFire = (calls: { url: string; body: string; auth: string }[]) => async (url: string, init: RequestInit) => {
  calls.push({ url, body: String(init.body), auth: (init.headers as Record<string, string>).Authorization });
  return new Response(JSON.stringify({ claude_code_session_url: "https://claude.ai/code/session_TOOL" }), { status: 200 });
};

test("ツールのルーティン: 合言葉は32文字以上で、Bearer で同じ値を送ったときだけ通す", () => {
  delete process.env.LAB_TOOL_TOKEN;
  assert.equal(labTokenOk(`Bearer ${LAB}`), false);
  process.env.LAB_TOOL_TOKEN = "short";
  assert.equal(labTokenOk("Bearer short"), false);
  process.env.LAB_TOOL_TOKEN = LAB;
  assert.equal(labTokenOk(`Bearer ${LAB}`), true);
  assert.equal(labTokenOk(`Bearer ${LAB}y`), false);
  assert.equal(labTokenOk(LAB), false);
  assert.equal(labTokenOk(null), false);
  // 起動の URL・トークン・合言葉がそろって、つながっているとみなす
  configure();
  assert.equal(toolRoutineConfigured(), true);
  process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL = "https://example.com/fire";
  assert.equal(toolRoutineConfigured(), false);
  configure();
});

test("ツールのルーティン: 開発待ちを頼むと、案件の番号と開発待ちの番号を渡し、頼んだ日時と作業の画面を覚える。1時間は頼み直せない", async () => {
  configure();
  const { projectId, approvalId } = devCase("雪玉密度鑑定所", "固める演出を強く");
  const calls: { url: string; body: string; auth: string }[] = [];
  const url = await startToolRoutine(approvalId, { manual: true, fetchImpl: okFire(calls) });
  assert.equal(url, "https://claude.ai/code/session_TOOL");
  assert.equal(calls[0].url, FIRE);
  assert.equal(calls[0].auth, "Bearer routine-secret");
  const text = (JSON.parse(calls[0].body) as { text: string }).text;
  assert.match(text, new RegExp(`案件 #${projectId}「雪玉密度鑑定所」`));
  assert.match(text, /じっくり案件/);
  assert.match(text, new RegExp(`開発待ちの番号: ${approvalId}`));
  assert.match(text, /直す指示: 固める演出を強く/);
  assert.doesNotMatch(text, new RegExp(LAB)); // 合言葉は渡さない（ルーティンの環境に入れてある）
  assert.ok(row(approvalId).routine_at);
  assert.equal(row(approvalId).routine_url, "https://claude.ai/code/session_TOOL");
  await assert.rejects(startToolRoutine(approvalId, { fetchImpl: okFire(calls) }), /1時間/);
  const v = toolRoutineView(row(approvalId));
  assert.equal(v.working, true);
  assert.equal(v.retryable, false);
  assert.equal(toolRoutineView(row(approvalId), Date.now() + 4 * 3600_000).working, false);
  assert.ok(toolRoutineText(row(approvalId)));
});

test("ツールのルーティン: 自動では、設定の同時に頼む数と1日に頼む数の範囲で、古い開発待ちから頼む", async () => {
  configure();
  db().exec("DELETE FROM approvals; DELETE FROM events");
  const ids = [devCase("a").approvalId, devCase("b").approvalId, devCase("c").approvalId, devCase("d").approvalId];
  const calls: { url: string; body: string; auth: string }[] = [];
  // 自動で頼まない設定
  saveSettings({ toolRoutineAuto: false, toolRoutineConcurrent: 2, toolRoutinePerDay: 3 });
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 0);
  // 同時に2件まで
  saveSettings({ toolRoutineAuto: true });
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 2);
  assert.deepEqual(ids.map((id) => !!row(id).routine_at), [true, true, false, false]);
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 0);
  // 1件入った（開発待ちが閉じた）ら、空いた分を頼む。ただし1日に3件まで
  db().prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(ids[0]);
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 1);
  db().prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(ids[1]);
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 0, "1日に3件まで");
  // 3時間たって入っていないものは作業中から外れるが、自動では頼み直さない
  const later = Date.now() + 25 * 3600_000;
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later }), 1);
  assert.deepEqual(ids.map((id) => !!row(id).routine_at), [true, true, true, true]);
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later + 3600_000 }), 0);
  // 起動に失敗したら、経過に残して、その回は続けて頼まない（1日の数を空けてから試す）
  db().exec("DELETE FROM approvals; DELETE FROM events");
  devCase("e"); devCase("f");
  const fail = async () => new Response("no", { status: 429 });
  assert.equal(await autoToolRoutine({ fetchImpl: fail }), 0);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE kind = 'tool-routine-error'").get());
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM approvals WHERE routine_at IS NOT NULL").get() as { n: number }).n, 0);
});

test("ツールのルーティンの入口: 合言葉がないと断り、依頼文・今のツール・様子を読めて、決まりに合わないツールは理由を返す", async () => {
  configure();
  const { approvalId } = devCase("入口の試し");
  const call = (method: "GET" | "POST", query: string, opts: { auth?: string; body?: unknown } = {}) => {
    const req = new Request(`http://x/api/tool-jobs/${approvalId}${query}`, { method, headers: { ...(opts.auth !== undefined ? { authorization: opts.auth } : {}), "Content-Type": "application/json" }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    const params = Promise.resolve({ id: String(approvalId) });
    return method === "GET" ? GET(req, { params }) : POST(req, { params });
  };
  const auth = `Bearer ${LAB}`;
  assert.equal((await call("GET", "?file=request")).status, 401);
  assert.equal((await call("GET", "?file=request", { auth: "Bearer wrong" })).status, 401);
  const req = await call("GET", "?file=request", { auth });
  assert.equal(req.status, 200);
  assert.match(await req.text(), /雪玉を固める/);
  assert.equal((await call("GET", "?file=tool", { auth })).status, 404); // まだツールがない
  assert.equal((await call("GET", "?file=data", { auth })).status, 404); // データがない
  const st = await call("GET", "?file=status", { auth });
  assert.deepEqual(((await st.json()) as { approval: { id: number; status: string } }).approval, { id: approvalId, status: "pending" });
  // 外部と通信するツールは入れない（理由を返す）
  const bad = await call("POST", "", { auth, body: { html: `<script>fetch("https://example.com")</script>` } });
  assert.equal(bad.status, 400);
  assert.match(((await bad.json()) as { error: string }).error, /決まりに合わない|fetch|通信/);
  assert.equal(row(approvalId).status, "pending");
  // 合言葉がなければ入れられない
  assert.equal((await call("POST", "", { body: { html: "<p>x</p>" } })).status, 401);
  // 開発待ちでない番号は 404
  const other = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason) VALUES (?, 'publish', 'p', 'r')").run(row(approvalId).project_id).lastInsertRowid);
  const r404 = await GET(new Request(`http://x/api/tool-jobs/${other}?file=request`, { headers: { authorization: auth } }), { params: Promise.resolve({ id: String(other) }) });
  assert.equal(r404.status, 404);
});

test("ツールのルーティン: 同時に頼まれても1回だけ起動し、起動に失敗したら頼んだ記録を戻す。1日の数は頼んだ回数で数える", async () => {
  configure();
  db().exec("DELETE FROM approvals; DELETE FROM events");
  const { approvalId } = devCase("同時");
  // 起動の返事が遅いあいだに、もう1回頼まれても、2回目は断る
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let fired = 0;
  const slow = async () => { fired++; await gate; return new Response(JSON.stringify({ claude_code_session_url: "https://claude.ai/code/session_SLOW" }), { status: 200 }); };
  const first = startToolRoutine(approvalId, { manual: true, fetchImpl: slow });
  await assert.rejects(startToolRoutine(approvalId, { fetchImpl: slow }), /頼んだばかり/);
  release();
  assert.equal(await first, "https://claude.ai/code/session_SLOW");
  assert.equal(fired, 1);
  assert.equal(row(approvalId).routine_url, "https://claude.ai/code/session_SLOW");
  // 起動に失敗したら、頼んだ記録（前の日時と作業の画面）を戻す
  const before = row(approvalId);
  const fail = async () => new Response("no", { status: 500 });
  await assert.rejects(startToolRoutine(approvalId, { manual: true, fetchImpl: fail, now: Date.now() + 2 * 3600_000 }), /起動できませんでした/);
  assert.equal(row(approvalId).routine_at, before.routine_at);
  assert.equal(row(approvalId).routine_url, before.routine_url);
  // 同じ開発待ちを頼み直した分も、1日に頼む数に数える（1回目 + 2時間後に頼み直し = 2回）
  const calls: { url: string; body: string; auth: string }[] = [];
  await startToolRoutine(approvalId, { manual: true, fetchImpl: okFire(calls), now: Date.now() + 2 * 3600_000 });
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'tool-routine'").get() as { n: number }).n, 2);
  saveSettings({ toolRoutineAuto: true, toolRoutineConcurrent: 5, toolRoutinePerDay: 2 });
  devCase("次");
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 0, "頼み直しを含めて1日2回に達している");
});

test("ツールのルーティンの入口: もう開発待ちでない（入れ終わった）番号に入れようとしたら 404 を返す", async () => {
  configure();
  const { approvalId } = devCase("入れ終わり");
  db().prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(approvalId);
  const res = await POST(new Request(`http://x/api/tool-jobs/${approvalId}`, { method: "POST", headers: { authorization: `Bearer ${LAB}`, "Content-Type": "application/json" }, body: JSON.stringify({ html: "<p>x</p>" }) }), { params: Promise.resolve({ id: String(approvalId) }) });
  assert.equal(res.status, 404);
  // 様子は、入れ終わったあとも読める
  const st = await GET(new Request(`http://x/api/tool-jobs/${approvalId}?file=status`, { headers: { authorization: `Bearer ${LAB}` } }), { params: Promise.resolve({ id: String(approvalId) }) });
  assert.equal(st.status, 200);
});

test("ツールのルーティン: 「直す」か「新しく作る」かは、今のツールがあるかで見分ける", () => {
  assert.equal(hasTool(null), false);
  assert.equal(hasTool(JSON.stringify({ headline: "紹介ページだけ" })), false);
  assert.equal(hasTool(JSON.stringify({ headline: "h", tool: { html: "<p>x</p>" } })), true);
  assert.equal(hasTool("{壊れた"), false);
  const { projectId, approvalId } = devCase("ページだけある");
  db().prepare("UPDATE projects SET lp = ? WHERE id = ?").run(JSON.stringify({ headline: "紹介ページだけ" }), projectId);
  assert.match(toolRoutineText(row(approvalId)), /新しく作る/);
  db().prepare("UPDATE projects SET lp = ? WHERE id = ?").run(JSON.stringify({ headline: "h", tool: { html: "<p>x</p>" } }), projectId);
  assert.match(toolRoutineText(row(approvalId)), /直す（今のツールがある）/);
});
