import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { clampPerQuery, lagWindow, searchSince } from "../src/lib/xPost";
import { VIRAL_MIN_LIKES, VIRAL_PICKS, VIRAL_QUERIES, VIRAL_QUERIES_EN, drainQueue, pickViral, searchAll, searchBeforeIdeas, searchReads, searchedToday } from "../src/lib/viralPosts";
import { WANT_QUERIES } from "../src/lib/userWants";

test("話題の投稿の検索: 読み始めは前回の検索のあと（7日より前・未来・なしなら、読める一番古いところ）", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  const oldest = "2026-11-10T13:00:00Z";
  assert.equal(searchSince(undefined, now), oldest);
  assert.equal(searchSince("", now), oldest);
  assert.equal(searchSince("2026-11-16T09:30:15.123Z", now), "2026-11-16T09:30:15Z");
  assert.equal(searchSince("2026-11-01T00:00:00Z", now), oldest);
  assert.equal(searchSince("2026-11-18T00:00:00Z", now), oldest);
  assert.equal(searchSince("こわれた値", now), oldest);
  assert.equal(clampPerQuery(5), 10);
  assert.equal(clampPerQuery(20), 20);
  assert.equal(clampPerQuery(300), 100);
});

test("話題の投稿の検索: 今日（日本時間）すでに検索したか", () => {
  // 日本時間 11/18 0:30 は、UTC では 11/17 15:30（今は日本時間 11/18 1:00）
  const now = Date.parse("2026-11-17T16:00:00Z");
  assert.equal(searchedToday("2026-11-17T15:30:00Z", "2026-11-18", now), true);
  assert.equal(searchedToday("2026-11-17T14:59:00Z", "2026-11-18", now), false);
  assert.equal(searchedToday("", "2026-11-18", now), false);
  assert.equal(searchedToday("こわれた値", "2026-11-18", now), false);
  // 未来の日時は「まだ」（PR #83 の ai-review の指摘）
  assert.equal(searchedToday("2026-11-17T15:30:00Z", "2026-11-18", now), true);
  assert.equal(searchedToday("2026-11-17T20:00:00Z", "2026-11-18", now), false);
});

test("話題の投稿の検索（運営者の依頼で広げた）: 日本語11種類・英語3種類。1回に読む数は 検索の数 × 件数", () => {
  assert.equal(VIRAL_QUERIES.length, 11);
  assert.equal(VIRAL_QUERIES_EN.length, 3);
  for (const word of ["ブラウザゲーム", "日替わり", "収益", "url:github.io", "心理テスト", "全問正解", "Claudeで作った", "画像が作れる", "#unity1week", "url:freem.ne.jp"]) assert.ok(VIRAL_QUERIES.some((q) => q.includes(word)), word);
  assert.ok(VIRAL_QUERIES_EN.some((q) => q.includes("#gamedev")));
  assert.ok(VIRAL_QUERIES_EN.some((q) => q.includes("I built")));
  // 日本語の検索は日本語の投稿だけ、英語の検索は英語の投稿だけを読む。画像付きだけに絞らない
  assert.ok(VIRAL_QUERIES.every((q) => q.includes("lang:ja") && !q.includes("has:media")));
  assert.ok(VIRAL_QUERIES_EN.every((q) => q.includes("lang:en")));
  // X の検索の言葉の長さの上限（512文字）に収まり、リポスト・返信は読まない
  for (const q of [...VIRAL_QUERIES, ...VIRAL_QUERIES_EN, ...WANT_QUERIES]) assert.ok(q.length <= 512 && q.includes("-is:retweet") && q.includes("-is:reply"), q);
  assert.equal(searchReads({ viralPerQuery: 20, wantsPerQuery: 10 }), 14 * 20 + 3 * 10);
  assert.equal(searchReads({ viralPerQuery: 20, wantsPerQuery: 0 }), 280);
  // 初めの値: 話題の投稿は検索1つあたり20件・2日遅らせて読む、「欲しい」の声は10件
  const s = getSettings();
  assert.equal(s.viralPerQuery, 20);
  assert.equal(s.viralLagDays, 2);
  assert.equal(s.wantsPerQuery, 10);
});

test("話題の投稿の検索（運営者の依頼で広げた）: 遅らせて読む範囲は、前回読み終えた所から今の lagDays 日前まで。日数を変えても、すき間も重なりもできない（PR #101 の ai-review の指摘）", () => {
  const now = Date.parse("2026-11-19T12:00:00Z");
  // 前回は 11/17 11:59:30 まで読んだ。2日遅らせると、そこから 11/17 11:59:30 の1日後（今の2日前）まで
  const cursor = "2026-11-16T11:59:30Z";
  assert.deepEqual(lagWindow(cursor, 2, now), { start: "2026-11-16T11:59:30Z", end: "2026-11-17T11:59:30Z" });
  // 次の日は、前の範囲の終わりそのものから（30秒のすき間もない）
  const w1 = lagWindow(cursor, 2, now)!;
  assert.equal(lagWindow(w1.end, 2, now + 86_400_000)!.start, w1.end);
  // 日数を減らしても（2日 → 0日）、前回の終わりから読む（読み飛ばさない）
  assert.deepEqual(lagWindow(w1.end, 0, now + 86_400_000), { start: w1.end, end: "2026-11-20T11:59:30Z" });
  // 日数を増やしたら（2日 → 5日）、終わりが前回の終わりに追いつくまで読まない（読み直さない）
  assert.equal(lagWindow(w1.end, 5, now + 86_400_000), null);
  assert.equal(lagWindow(w1.end, 5, now + 4 * 86_400_000)!.start, w1.end);
  // 初めて・壊れた値・未来の値は、読める一番古いところ（直近7日）から
  for (const c of [undefined, "", "こわれた値", "2026-11-20T00:00:00Z"]) assert.equal(lagWindow(c, 2, now)!.start, "2026-11-12T13:00:00Z", String(c));
  // 長く検索していなくても、7日より前にはさかのぼらない
  assert.equal(lagWindow("2026-11-01T00:00:00Z", 2, now)!.start, "2026-11-12T13:00:00Z");
});

test("話題の投稿の検索（運営者の依頼で広げた）: いいね20以上から、反応の大きい順に、取り込み済みを除いて選ぶ", () => {
  assert.equal(VIRAL_MIN_LIKES, 20);
  assert.deepEqual(VIRAL_PICKS, { ja: 7, en: 3 });
  const found = [
    { id: "a", likes: 19, score: 999 },
    { id: "b", likes: 20, score: 30 },
    { id: "c", likes: 500, score: 900 },
    { id: "d", likes: 80, score: 200 },
    { id: "e", likes: 300, score: 600 },
  ];
  assert.deepEqual(pickViral(found, new Set(["e"]), 2).map((x) => x.id), ["c", "d"]);
  assert.deepEqual(pickViral(found, new Set(), 10).map((x) => x.id), ["c", "e", "d", "b"]);
});

test("アイデア出しの前の検索: 今日まだなら検索1つにつき1回だけ、前回のあとの投稿を読む。同じ日の2回目は読まない", async () => {
  const calls: URL[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    return new Response(JSON.stringify({ data: [], meta: {} }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  // X のキーがないときは、何もしない
  await searchBeforeIdeas();
  assert.equal(calls.length, 0);
  Object.assign(process.env, { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" });
  try {
    const last = new Date(Date.now() - 2 * 86_400_000).toISOString();
    // 話題の投稿で前回読み終えた所（前回の検索の2日前）
    const cursor = new Date(Date.parse(last) - 2 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    // 検索しない設定のときは、何もしない
    saveSettings({ viralSearch: false, lastViralSearch: last, viralCursor: cursor });
    await searchBeforeIdeas();
    assert.equal(calls.length, 0);
    saveSettings({ viralSearch: true });
    await searchBeforeIdeas();
    // 話題の投稿 日本語11種類＋英語3種類 × 20件 と、「欲しい」の声 3種類 × 10件
    const viral = [...VIRAL_QUERIES, ...VIRAL_QUERIES_EN];
    assert.equal(calls.length, viral.length + WANT_QUERIES.length);
    assert.deepEqual(calls.map((u) => u.searchParams.get("max_results")), [...viral.map(() => "20"), ...WANT_QUERIES.map(() => "10")]);
    assert.deepEqual(calls.map((u) => u.searchParams.get("query")), [...viral, ...WANT_QUERIES]);
    // 話題の投稿は、前回読み終えた所から、今の2日前まで読む。「欲しい」の声は前回の検索のあとから
    const viralCalls = calls.slice(0, viral.length);
    assert.ok(viralCalls.every((u) => u.searchParams.get("start_time") === cursor));
    assert.ok(viralCalls.every((u) => Date.parse(u.searchParams.get("end_time")!) <= Date.now() - 2 * 86_400_000));
    // 次に読み始める所は、今回の範囲の終わり
    assert.equal(getSettings().viralCursor, viralCalls[0].searchParams.get("end_time"));
    assert.ok(calls.slice(viral.length).every((u) => u.searchParams.get("start_time") === last.replace(/\.\d{3}Z$/, "Z") && !u.searchParams.get("end_time")));
    assert.ok(searchedToday(getSettings().lastViralSearch));
    // 同じ日の2回目は検索しない
    await searchBeforeIdeas();
    assert.equal(calls.length, VIRAL_QUERIES.length + VIRAL_QUERIES_EN.length + WANT_QUERIES.length);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"]) delete process.env[k];
  }
});

test("アイデア出しの前の検索: X の検索が失敗しても止めず、その日はもう検索しない", async () => {
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    n++;
    return new Response(JSON.stringify({ title: "Too Many Requests" }), { status: 429, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  Object.assign(process.env, { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" });
  try {
    saveSettings({ viralSearch: true, lastViralSearch: new Date(Date.now() - 3 * 86_400_000).toISOString(), viralCursor: "" });
    await searchBeforeIdeas();
    assert.equal(n, 1);
    assert.ok(searchedToday(getSettings().lastViralSearch));
    await searchBeforeIdeas();
    assert.equal(n, 1);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"]) delete process.env[k];
  }
});

const X_ENV = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });

test("話題の投稿の検索（PR #83 の ai-review の指摘）: 途中で失敗しても読めた分は取り込み、「欲しい」の声は読まず、次は始めた時刻のあとから読む", async () => {
  const searches: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/2/tweets/search/recent") {
      searches.push(Date.now());
      await new Promise((ok) => setTimeout(ok, 30));
      // 1種類目は伸びた投稿を1件返し、2種類目で失敗する
      if (searches.length === 1) return json({ data: [{ id: "900000000000000001", text: "ゲーム作りました", public_metrics: { like_count: 120, retweet_count: 5, reply_count: 1, quote_count: 0, bookmark_count: 3 } }], meta: {} });
      return json({ title: "Too Many Requests" }, 429);
    }
    // 取り込んだ投稿の本文の読み取り（fxtwitter）は失敗させる（まとめは「読めませんでした」になる）
    return json({ message: "NOT_FOUND" }, 404);
  }) as typeof fetch;
  Object.assign(process.env, X_ENV);
  try {
    saveSettings({ viralSearch: true, lastViralSearch: new Date(Date.now() - 2 * 86_400_000).toISOString(), viralCursor: "" });
    await searchBeforeIdeas();
    // 2種類目で止め、「欲しい」の声は読まない
    assert.equal(searches.length, 2);
    // 1種類目で読めた投稿は取り込まれている（まとめは本文を読めずに失敗で終わり、待ちのまま残らない）
    const row = db().prepare("SELECT source, status FROM viral_posts WHERE tweet_id = ?").get("900000000000000001") as { source: string; status: string } | undefined;
    assert.deepEqual(row, { source: "search", status: "error" });
    // 次の検索の読み始めは、検索を始めた時刻（最初の検索より前）
    assert.ok(Date.parse(getSettings().lastViralSearch) <= searches[0]);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(X_ENV)) delete process.env[k];
  }
});

test("話題の投稿のまとめを待つ時間（PR #83 の ai-review の指摘）: AIの呼び出しが止まっても、決めた時間で待つのをやめる", async () => {
  const realFetch = globalThis.fetch;
  // 本文の読み取りが返ってこない
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  try {
    db().prepare("INSERT INTO viral_posts (tweet_id, url, source) VALUES (?, ?, 'search')").run("900000000000000002", "https://x.com/i/web/status/900000000000000002");
    const t = Date.now();
    await drainQueue(300);
    assert.ok(Date.now() - t < 2000, `待った時間 ${Date.now() - t}ms`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("話題の投稿の検索（PR #83 の ai-review の指摘）: 検索の一式は同時に1つだけ動き、動いている間に呼ばれたら同じ結果を待つ", async () => {
  let n = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    n++;
    await new Promise((ok) => setTimeout(ok, 20));
    return json({ data: [], meta: {} });
  }) as typeof fetch;
  Object.assign(process.env, X_ENV);
  try {
    // 話題の投稿で読み終えた所は空にする（前のテストで覚えた所が残っていると、読む範囲がなくなる）
    saveSettings({ lastViralSearch: new Date(Date.now() - 2 * 86_400_000).toISOString(), viralCursor: "" });
    // 1つ目が「欲しい」の声を検索している途中で、2つ目を呼ぶ
    const first = searchAll();
    const all = VIRAL_QUERIES.length + VIRAL_QUERIES_EN.length + WANT_QUERIES.length;
    // 待ちすぎない（作りが変わって話題の投稿を読まなくなったとき、テストが終わらなくならないように）
    for (let i = 0; i < 2000 && n <= VIRAL_QUERIES.length + VIRAL_QUERIES_EN.length; i++) await new Promise((ok) => setTimeout(ok, 5));
    const second = searchAll();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a, b);
    assert.equal(n, all);
    // 終わったあとは、また検索できる（話題の投稿は遅らせて読むので、すぐあとの2回目は読む範囲がなく、「欲しい」の声だけを読む）
    await searchAll();
    assert.equal(n, all + WANT_QUERIES.length);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(X_ENV)) delete process.env[k];
  }
});

test("検索の件数の設定（PR #83 の ai-review の指摘）: 「欲しい」の声は 0 か 10〜100 だけ受け付ける", async () => {
  const { POST } = await import("../src/app/api/settings/route");
  const send = (v: number) => POST(new Request("http://localhost/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wantsPerQuery: v }) }));
  assert.equal((await send(5)).status, 400);
  assert.equal((await send(101)).status, 400);
  assert.equal((await send(0)).status, 200);
  assert.equal(getSettings().wantsPerQuery, 0);
  assert.equal((await send(10)).status, 200);
  assert.equal(getSettings().wantsPerQuery, 10);
});
