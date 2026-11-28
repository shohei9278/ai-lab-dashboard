import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings, type ApprovalRow } from "../src/lib/db";
import { AUTO_TRIES, autoToolRoutine, autoWork, hasTool, labTokenOk, startToolRoutine, toolRoutineConfigured, toolRoutineStatus, toolRoutineText, toolRoutineView } from "../src/lib/toolRoutine";
import { GET, POST } from "../src/app/api/tool-jobs/[id]/route";
import { pendingApprovals, pendingCount } from "../src/lib/views";

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
  // 3時間たって入っていないものは作業中から外れ、自動でもう1回だけ頼み直す（まだ頼んでいないものが先）
  const later = Date.now() + 25 * 3600_000;
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later }), 2);
  assert.deepEqual(ids.map((id) => row(id).routine_tries), [1, 1, 2, 1]);
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later + 3600_000 }), 0, "作業中");
  // 2回頼んでも入らなかったものは、自動では頼まない（人の判断待ちに回る）
  const later2 = later + 25 * 3600_000;
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later2 }), 1);
  assert.deepEqual(ids.map((id) => row(id).routine_tries), [1, 1, 2, 2]);
  const gaveUp = () => (db().prepare("SELECT message FROM events WHERE kind = 'tool-routine-gave-up' ORDER BY id").all() as { message: string }[]).map((x) => x.message);
  assert.equal(gaveUp().length, 1, "c は2回頼んでも入らなかったので、判断待ちに出したことを残して知らせる");
  assert.match(gaveUp()[0], new RegExp(`（開発待ち #${ids[2]}）$`));
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later2 + 25 * 3600_000 }), 0);
  assert.equal(gaveUp().length, 2);
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls), now: later2 + 50 * 3600_000 }), 0);
  assert.equal(gaveUp().length, 2, "知らせは1件に1回だけ");
  // 2回目を頼んだあとに自動で頼む設定をオフにしても、入らなかったものは知らせる（PR #167 の ai-review の指摘）
  const e = devCase("e").approvalId;
  db().prepare("UPDATE approvals SET routine_at = datetime('now', '-5 hours'), routine_tries = ? WHERE id = ?").run(AUTO_TRIES, e);
  saveSettings({ toolRoutineAuto: false });
  assert.equal(await autoToolRoutine({ fetchImpl: okFire(calls) }), 0);
  assert.equal(gaveUp().length, 3);
  saveSettings({ toolRoutineAuto: true });
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

test("チェックで止まったツール: 公開の判断待ちにせず、指摘を直す指示にした開発待ちを作る（同じ案件は7日に1回・ツールだけ・設定でオフにできる）", async () => {
  const { heldToRoutine } = await import("../src/lib/toolRoutine");
  configure();
  db().exec("DELETE FROM approvals; DELETE FROM events");
  const tool = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('止まったツール', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool')").run().lastInsertRowid);
  const lp = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('LP', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'lp')").run().lastInsertRowid);
  const issues = ["ボタンが画面の下に隠れる", "紹介ページ: 保存できると言い切っている"];
  // 設定でオフなら回さない
  saveSettings({ toolRoutineFixHeld: false });
  assert.equal(heldToRoutine(tool, issues), false);
  saveSettings({ toolRoutineFixHeld: true });
  // 事前登録のページ（ツールでない）は回さない
  assert.equal(heldToRoutine(lp, issues), false);
  // ツールは、指摘を直す指示にした開発待ちを作る（ルーティンの自動の数の範囲で頼まれる）
  assert.equal(heldToRoutine(tool, issues), true);
  const dev = db().prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = 'dev'").get(tool) as ApprovalRow;
  const payload = JSON.parse(dev.payload ?? "{}") as { instruction: string; heldFix: boolean; design: string };
  assert.equal(payload.heldFix, true);
  assert.match(payload.instruction, /1\. ボタンが画面の下に隠れる/);
  assert.match(payload.instruction, /2\. 紹介ページ: 保存できると言い切っている/);
  assert.match(payload.design, /設計書はありません/);
  assert.match(toolRoutineText(dev), /直す指示: 公開の前のチェックで/);
  assert.equal(db().prepare("SELECT 1 FROM approvals WHERE project_id = ? AND kind = 'publish'").get(tool), undefined);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE kind = 'held-to-routine' AND project_id = ?").get(tool));
  // 開発待ちが残っている間・7日以内は、もう回さない（人の判断待ちに出す）
  assert.equal(heldToRoutine(tool, issues), false);
  db().prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(dev.id);
  assert.equal(heldToRoutine(tool, issues), false, "7日以内に一度回した");
  db().prepare("UPDATE approvals SET created_at = datetime('now', '-8 days') WHERE id = ?").run(dev.id);
  assert.equal(heldToRoutine(tool, issues), true, "8日たてばまた回す");
  // 指摘が長くても、直す指示は切らずに全文を残す。起動のときの文は短くして、全文が依頼文にあると書き添える
  db().exec("DELETE FROM approvals");
  const long = Array.from({ length: 40 }, (_, i) => `問題その${i + 1}: ${"とても長い説明".repeat(20)}`);
  assert.equal(heldToRoutine(tool, long), true);
  const longDev = db().prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = 'dev' ORDER BY id DESC").get(tool) as ApprovalRow;
  const full = (JSON.parse(longDev.payload ?? "{}") as { instruction: string }).instruction;
  assert.ok(full.length > 4000);
  assert.match(full, /40\. 問題その40/);
  const fire = toolRoutineText(longDev);
  assert.match(fire, /全文はダッシュボードの依頼文にあります/);
  assert.ok(fire.length < 2000);
  const req = await GET(new Request(`http://x/api/tool-jobs/${longDev.id}?file=request`, { headers: { authorization: `Bearer ${LAB}` } }), { params: Promise.resolve({ id: String(longDev.id) }) });
  assert.match(await req.text(), /40\. 問題その40/);
  // ルーティンがつながっていなければ回さない
  delete process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL;
  db().exec("DELETE FROM approvals");
  assert.equal(heldToRoutine(tool, issues), false);
  configure();
});

test("本番の作業中: ルーティンが作業中の開発待ちも、/api/live の building に出す（3時間たったもの・入れ終わったものは出さない）", async () => {
  const { routinesWorking } = await import("../src/lib/toolRoutine");
  const { liveSnapshot } = await import("../src/lib/live");
  configure();
  db().exec("DELETE FROM approvals");
  const working = devCase("作業中");
  const old = devCase("3時間たった");
  const done = devCase("入れ終わった");
  db().prepare("UPDATE approvals SET routine_at = datetime('now', '-30 minutes') WHERE id = ?").run(working.approvalId);
  db().prepare("UPDATE approvals SET routine_at = datetime('now', '-4 hours') WHERE id = ?").run(old.approvalId);
  db().prepare("UPDATE approvals SET routine_at = datetime('now', '-10 minutes'), status = 'approved' WHERE id = ?").run(done.approvalId);
  devCase("まだ頼んでいない");
  assert.deepEqual(routinesWorking().map((r) => r.id), [working.projectId]);
  const b = liveSnapshot().building;
  assert.deepEqual(b.map((x) => x.id), [working.projectId]);
  assert.match(b[0].what, /ルーティン/);
  assert.equal(b[0].title, "作業中");
});

test("判断待ちとAIの作業待ち: 自動で頼む開発待ちはAIの作業待ちに出し、判断待ちの数に数えない。2回頼んでも入らない・自動がオフのものは判断待ちに出す", async () => {
  configure();
  db().exec("DELETE FROM approvals; DELETE FROM events");
  saveSettings({ toolRoutineAuto: true, toolRoutineConcurrent: 1, toolRoutinePerDay: 5, killSwitch: false });
  const a = devCase("まだ").approvalId;
  const b = devCase("2回目").approvalId;
  const c = devCase("あきらめ").approvalId;
  db().prepare("UPDATE approvals SET routine_at = datetime('now', '-5 hours'), routine_tries = 1 WHERE id = ?").run(b);
  db().prepare("UPDATE approvals SET routine_at = datetime('now', '-5 hours'), routine_tries = ? WHERE id = ?").run(AUTO_TRIES, c);
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id) VALUES ('公開', 't', 'p', 's', 'h', 'r', 'idea', 'claude')").run().lastInsertRowid);
  const pub = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason) VALUES (?, 'publish', '公開する', 'r')").run(pid).lastInsertRowid);
  // 作業中のもの・まだ頼める回数が残っているものは自動。頼める回数を使い切ったもの・開発待ち以外は人
  assert.deepEqual([a, b, c, pub].map((id) => autoWork(row(id))), [true, true, false, false]);
  assert.deepEqual(pendingApprovals(undefined, true, "auto").map((x) => x.id), [a, b]);
  assert.deepEqual(pendingApprovals(undefined, true, "human").map((x) => x.id), [c, pub]);
  assert.equal(pendingApprovals(undefined, true).length, 4, "案件のページでは両方出す");
  assert.equal(pendingCount(), 2);
  // 使い切ったものでも、手で頼み直して作業中なら、AIの作業待ち
  db().prepare("UPDATE approvals SET routine_at = datetime('now') WHERE id = ?").run(c);
  assert.equal(autoWork(row(c)), true);
  // 自動で頼まない設定・止めるスイッチ・ルーティンがつながっていないときは、すべて判断待ち
  saveSettings({ toolRoutineAuto: false });
  assert.equal(pendingCount(), 4);
  saveSettings({ toolRoutineAuto: true, killSwitch: true });
  assert.equal(pendingCount(), 4);
  saveSettings({ killSwitch: false });
  delete process.env.CLAUDE_TOOL_ROUTINE_FIRE_URL;
  assert.equal(pendingCount(), 4);
  configure();
  assert.equal(pendingCount(), 1);
});

test("ツールのルーティンの様子: 上限・作業中・止めている理由・次に頼む開発待ちを返す（11/28 に運営者が決めた。#79 が約40分自動で頼まれなかった）", () => {
  configure();
  db().exec("DELETE FROM events WHERE kind = 'tool-routine'; DELETE FROM approvals; DELETE FROM lp_versions");
  saveSettings({ toolRoutineAuto: true, killSwitch: false, toolRoutineConcurrent: 1, toolRoutinePerDay: 3 });
  const now = Date.parse("2026-11-28T06:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
  // 開発待ちがなければ、頼むものがない
  let st = toolRoutineStatus(now);
  assert.equal(st.off, null);
  assert.equal(st.next, null);
  assert.equal(st.waiting, 0);
  // 古いものから頼む順。作業中（頼んで3時間以内）は順番待ちに入れない
  const a = devCase("作業中のツール");
  db().prepare("UPDATE approvals SET routine_at = ?, routine_tries = 1 WHERE id = ?").run(iso(now - 3_600_000), a.approvalId);
  const b = devCase("待っているツール");
  st = toolRoutineStatus(now);
  assert.deepEqual(st.working.map((w) => w.projectId), [a.projectId]);
  assert.equal(st.waiting, 1);
  assert.equal(st.next?.projectId, b.projectId);
  assert.equal(st.next?.title, "待っているツール");
  // 直近24時間に頼んだ数（手で頼んだ分も）。上限に達したら、上限を超えた分だけ古い依頼の24時間後から頼める
  for (const h of [20, 10, 2]) db().prepare("INSERT INTO events (project_id, actor, kind, message, at) VALUES (NULL, 'system', 'tool-routine', '頼んだ', ?)").run(iso(now - h * 3_600_000));
  db().prepare("INSERT INTO events (project_id, actor, kind, message, at) VALUES (NULL, 'system', 'tool-routine', '頼んだ', ?)").run(iso(now - 25 * 3_600_000));
  st = toolRoutineStatus(now);
  assert.equal(st.fired, 3);
  assert.equal(st.perDay, 3);
  assert.equal(st.resumeAt, new Date(now - 20 * 3_600_000 + 86_400_000).toISOString());
  saveSettings({ toolRoutinePerDay: 6 });
  assert.equal(toolRoutineStatus(now).resumeAt, null);
  // 止めている理由
  saveSettings({ toolRoutineAuto: false });
  assert.match(toolRoutineStatus(now).off ?? "", /自動でルーティンに頼む」がオフ/);
  saveSettings({ toolRoutineAuto: true, killSwitch: true });
  assert.match(toolRoutineStatus(now).off ?? "", /緊急停止中/);
  saveSettings({ killSwitch: false, toolRoutinePerDay: 0 });
  assert.match(toolRoutineStatus(now).off ?? "", /1日（24時間）に頼む数」が0/);
  saveSettings({ toolRoutinePerDay: 6 });
  delete process.env.CLAUDE_TOOL_ROUTINE_TOKEN;
  assert.match(toolRoutineStatus(now).off ?? "", /つながっていない/);
  configure();
});
