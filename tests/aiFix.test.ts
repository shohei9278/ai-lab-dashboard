import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { aiFixBranch, aiFixConfigured, aiFixPrsUrl, aiFixRetryable, aiFixText, startAiFix } from "../src/lib/aiFix";
import type { RequestRow } from "../src/lib/plan";

// 提案箱の「仕組みの改善」を、クラウドの Claude Code（ルーティン）に直してもらう（運営者が決めた。人はマージだけ）

const FIRE = "https://api.anthropic.com/v1/claude_code/routines/trig_01ABCDEF/fire";
const add = (target: "system" | "human", status = "open") =>
  Number(db().prepare("INSERT INTO plan_requests (title, how, why, status, source, target, score) VALUES (?, ?, ?, ?, 'meeting', ?, 7.5)").run(`題${Math.random()}`, "集計を直す", "数字がずれる", status, target).lastInsertRowid);
const row = (id: number) => db().prepare("SELECT * FROM plan_requests WHERE id = ?").get(id) as RequestRow;

test("Claude Code に直してもらう: 決まった送り先とトークンがあるときだけ、つながっているとみなす", () => {
  process.env.CLAUDE_ROUTINE_TOKEN = "t";
  process.env.CLAUDE_ROUTINE_FIRE_URL = "https://example.com/v1/claude_code/routines/trig_01/fire";
  assert.equal(aiFixConfigured(), false);
  process.env.CLAUDE_ROUTINE_FIRE_URL = FIRE;
  assert.equal(aiFixConfigured(), true);
  delete process.env.CLAUDE_ROUTINE_TOKEN;
  assert.equal(aiFixConfigured(), false);
});

test("Claude Code に直してもらう: 提案の中身とひとことを渡し、作業の画面を覚え、1時間は頼み直せない", async () => {
  process.env.CLAUDE_ROUTINE_FIRE_URL = FIRE;
  process.env.CLAUDE_ROUTINE_TOKEN = "secret-token";
  const id = add("system");
  const calls: { url: string; init: RequestInit }[] = [];
  const ok = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ type: "routine_fire", claude_code_session_id: "s", claude_code_session_url: "https://claude.ai/code/session_01" }), { status: 200 });
  };
  const r = await startAiFix(id, "  テストも足して  ", ok);
  assert.equal(r.sessionUrl, "https://claude.ai/code/session_01");
  assert.equal(calls[0].url, FIRE);
  const h = calls[0].init.headers as Record<string, string>;
  assert.equal(h.Authorization, "Bearer secret-token");
  assert.equal(h["anthropic-beta"], "experimental-cc-routine-2026-04-01");
  const text = (JSON.parse(String(calls[0].init.body)) as { text: string }).text;
  assert.match(text, new RegExp(`提案箱 #${id}`));
  assert.match(text, /何をどう変えるか: 集計を直す/);
  assert.match(text, /運営者のひとこと: テストも足して/);
  assert.match(text, new RegExp(`ブランチ: claude/proposal-${id}`));
  const saved = row(id);
  assert.ok(saved.ai_fix_at);
  assert.equal(saved.ai_fix_url, "https://claude.ai/code/session_01");
  assert.equal(saved.ai_fix_note, "テストも足して");
  assert.equal(saved.status, "open"); // 「やった」は、マージしたあとに運営者が答える
  // 頼んだばかりの提案は、頼み直せない
  await assert.rejects(startAiFix(id, "", ok), /1時間/);
  assert.equal(calls.length, 1);
  assert.equal(aiFixRetryable(saved, Date.now() + 61 * 60 * 1000), true);
  // できた PR がレビュー待ちの間は、時間がたっても頼めない
  assert.equal(aiFixRetryable({ ...saved, ai_fix_pr_state: "open" }, Date.now() + 61 * 60 * 1000), false);
  assert.equal(aiFixRetryable({ ...saved, ai_fix_pr_state: "closed" }, Date.now() + 61 * 60 * 1000), true);
  // 閉じた PR のあとに頼み直すと、前の PR の番号と状態を消す
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now', '-2 hours'), ai_fix_pr = 3, ai_fix_pr_state = 'closed' WHERE id = ?").run(id);
  await startAiFix(id, "", ok);
  assert.equal(row(id).ai_fix_pr, null);
  assert.equal(row(id).ai_fix_pr_state, null);
});

test("Claude Code に直してもらう: 運営者にやってほしいこと・答えた提案は頼めず、起動に失敗したら覚えない", async () => {
  process.env.CLAUDE_ROUTINE_FIRE_URL = FIRE;
  process.env.CLAUDE_ROUTINE_TOKEN = "secret-token";
  const never = async () => { throw new Error("呼ばれてはいけない"); };
  await assert.rejects(startAiFix(add("human"), "", never), /仕組みの改善/);
  await assert.rejects(startAiFix(add("system", "done"), "", never), /仕組みの改善/);
  const id = add("system");
  const fail = async () => new Response("bad secret-token", { status: 401 });
  await assert.rejects(startAiFix(id, "", fail), (e: Error) => /401/.test(e.message) && !/secret/.test(e.message));
  assert.equal(row(id).ai_fix_at, null);
  // 作業の画面の URL が claude.ai でなければ、覚えない
  const odd = async () => new Response(JSON.stringify({ claude_code_session_url: "javascript:alert(1)" }), { status: 200 });
  assert.equal((await startAiFix(id, "", odd)).sessionUrl, null);
  assert.equal(row(id).ai_fix_url, null);
});

test("Claude Code に直してもらう: ブランチの名前と、できた PR を探すリンク", () => {
  assert.equal(aiFixBranch(12), "claude/proposal-12");
  assert.equal(aiFixPrsUrl(12), "https://github.com/shohei9278/ai-lab-dashboard/pulls?q=is%3Apr%20head%3Aclaude%2Fproposal-12");
  const text = aiFixText({ id: 3, title: "t", how: null, why: null, source: "scene", scene: "判断 #4", score: null, project_id: 9 } as RequestRow, "");
  assert.doesNotMatch(text, /運営者のひとこと|何をどう|理由/);
  assert.match(text, /作業の途中で（判断 #4）・案件 #9/);
  // 運営者が入れた提案は「運営者」と書く（ダッシュボードの中の「あなた」のままだと、ルーティンには誰のことか分からない）
  assert.match(aiFixText({ id: 4, title: "t", how: null, why: null, source: "human", scene: "あなた", score: null, project_id: null } as RequestRow, ""), /出どころ: 運営者$/m);
});

test("Claude Code に直してもらう: PR の状態を GitHub から読み、マージされたら「やった」にする（閉じただけなら返事を待つ）", async () => {
  const { syncAiFixPrs } = await import("../src/lib/aiFix");
  const merged = add("system"), open = add("system"), closed = add("system"), none = add("system");
  for (const id of [merged, open, closed, none]) db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now') WHERE id = ?").run(id);
  const urls: string[] = [];
  const gh = async (url: string) => {
    urls.push(url);
    const head = decodeURIComponent(new URL(url).searchParams.get("head") ?? "");
    const pulls = head.endsWith(`proposal-${merged}`) ? [{ number: 5, state: "closed", merged_at: null }, { number: 7, state: "closed", merged_at: "2026-11-21T00:00:00Z" }]
      : head.endsWith(`proposal-${open}`) ? [{ number: 8, state: "open", merged_at: null }]
      : head.endsWith(`proposal-${closed}`) ? [{ number: 9, state: "closed", merged_at: null }] : [];
    return new Response(JSON.stringify(pulls), { status: 200 });
  };
  assert.equal(await syncAiFixPrs(gh, true), 1);
  assert.ok(urls.every((u) => u.startsWith("https://api.github.com/repos/shohei9278/ai-lab-dashboard/pulls?state=all")));
  assert.ok(urls.some((u) => u.includes(encodeURIComponent(`shohei9278:claude/proposal-${merged}`))));
  const m = row(merged);
  assert.equal(m.status, "done");
  assert.equal(m.ai_fix_pr, 7);
  assert.equal(m.ai_fix_pr_state, "merged");
  assert.match(m.note ?? "", /PR #7/);
  assert.equal(row(open).ai_fix_pr_state, "open");
  assert.equal(row(open).status, "open");
  assert.equal(row(closed).ai_fix_pr_state, "closed");
  assert.equal(row(closed).status, "open");
  assert.equal(row(none).ai_fix_pr, null);
  // 1時間に1回まで（force でないときは、続けて読まない）
  const n = urls.length;
  await syncAiFixPrs(gh);
  assert.equal(urls.length, n);
  // 「やった」になったものは、もう読まない
  await syncAiFixPrs(gh, true);
  assert.ok(!urls.slice(n).some((u) => u.includes(`proposal-${merged}`)));
});
