import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { syncComments } from "../src/lib/snsComments";
import { syncReactions } from "../src/lib/postReactions";
import { threadsPost } from "../src/lib/snsApi";

// Threads の読み込みが失敗したとき（トークンが切れたときなど）、0件として黙らずに記録が残ること

const events = (kind: string) => db().prepare("SELECT message FROM events WHERE kind = ? ORDER BY id").all(kind) as { message: string }[];

function withFailingFetch() {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(JSON.stringify({ error: { message: "Error validating access token: Session has expired" } }), { status: 400 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const projectId = () => Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('試し', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool')").run().lastInsertRowid);

test("コメントの取り込み: Threads の自分の投稿の一覧を読めないと sns-comments-error を残す", async () => {
  process.env.THREADS_ACCESS_TOKEN = "dummy";
  const pid = projectId();
  db().prepare("INSERT INTO sns_posts (project_id, platform, code, text, status, posted_at, post_url) VALUES (?, 'threads', 'c-comments', '本文', 'posted', datetime('now', '-1 day'), 'https://www.threads.net/@me/post/ABC')").run(pid);
  const f = withFailingFetch();
  try {
    assert.equal(await syncComments(), 0);
    assert.ok(f.calls.some((u) => u.includes("/me/threads")));
    const e = events("sns-comments-error");
    assert.equal(e.length, 1);
    assert.match(e[0].message, /Threads.*400.*Session has expired/);
    assert.doesNotMatch(e[0].message, /dummy/); // トークンを記録に出さない
  } finally {
    f.restore();
    delete process.env.THREADS_ACCESS_TOKEN;
  }
});

test("反応の取り込み: Threads の自分の投稿の一覧を読めないと reactions-error を残す", async () => {
  process.env.THREADS_ACCESS_TOKEN = "dummy";
  const pid = projectId();
  db().prepare("INSERT INTO sns_posts (project_id, platform, code, text, status, author, posted_at, post_url) VALUES (?, 'threads', 'c-reactions', '本文', 'posted', 'ai', datetime('now', '-30 hours'), 'https://www.threads.net/@me/post/DEF')").run(pid);
  const f = withFailingFetch();
  try {
    assert.equal(await syncReactions(), 0);
    const e = events("reactions-error");
    assert.equal(e.length, 1);
    assert.match(e[0].message, /threads.*自分の投稿の一覧を読めません（400）/);
  } finally {
    f.restore();
    delete process.env.THREADS_ACCESS_TOKEN;
  }
});

test("トークンの延長: 失敗したら threads-token-error を残す（1日1回まで）", async () => {
  process.env.THREADS_ACCESS_TOKEN = "dummy";
  const f = withFailingFetch();
  try {
    await assert.rejects(threadsPost({ text: "試し" }), /Threads への投稿に失敗/);
    await assert.rejects(threadsPost({ text: "試し" }), /Threads への投稿に失敗/);
    assert.equal(f.calls.filter((u) => u.includes("refresh_access_token")).length, 2);
    const e = events("threads-token-error");
    assert.equal(e.length, 1);
    assert.match(e[0].message, /延長できません（400）/);
    assert.doesNotMatch(e[0].message, /dummy/);
  } finally {
    f.restore();
    delete process.env.THREADS_ACCESS_TOKEN;
  }
});

test("トークンの延長: 通信そのものが失敗しても threads-token-error を残し、投稿は続ける（トークンは書かない）", async () => {
  process.env.THREADS_ACCESS_TOKEN = "dummy-token-value";
  // 前のテストの「1日1回まで」を戻し、延長してから20日以上たった形にする
  (globalThis as { __aiLabThreadsRefreshErrAt?: number }).__aiLabThreadsRefreshErrAt = undefined;
  db().prepare("DELETE FROM events WHERE kind = 'threads-token-error'").run();
  const realFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    if (url.includes("refresh_access_token")) throw new TypeError(`fetch failed: ${url}`);
    return new Response(JSON.stringify({ error: { message: "stop here" } }), { status: 400 });
  }) as typeof fetch;
  try {
    // 延長の通信が落ちても例外で止まらず、そのあとの投稿まで進む（投稿は 400 で失敗する）
    await assert.rejects(threadsPost({ text: "試し" }), /Threads への投稿に失敗/);
    assert.ok(calls.some((u) => !u.includes("refresh_access_token")));
    const e = events("threads-token-error");
    assert.equal(e.length, 1);
    assert.match(e[0].message, /延長できません（通信の失敗）/);
    assert.doesNotMatch(e[0].message, /dummy-token-value/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.THREADS_ACCESS_TOKEN;
  }
});

test("コメントの取り込み: Threads の通信そのものが失敗しても、sns-comments-error にトークンを書かない", async () => {
  process.env.THREADS_ACCESS_TOKEN = "dummy-token-value";
  db().prepare("DELETE FROM events WHERE kind = 'sns-comments-error'").run();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    throw new TypeError(`fetch failed: ${String(input)}`);
  }) as typeof fetch;
  try {
    // 1つ目のテストで入れた Threads の投稿（14日以内）が対象になる
    assert.equal(await syncComments(), 0);
    const e = events("sns-comments-error");
    assert.equal(e.length, 1);
    assert.match(e[0].message, /Threads.*自分の投稿の一覧を読めません（通信の失敗）/);
    assert.doesNotMatch(e[0].message, /dummy-token-value|access_token/);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.THREADS_ACCESS_TOKEN;
  }
});
