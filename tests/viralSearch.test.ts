import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSettings, saveSettings } from "../src/lib/db";
import { clampPerQuery, searchSince } from "../src/lib/xPost";
import { VIRAL_QUERIES, searchBeforeIdeas, searchReads, searchedToday } from "../src/lib/viralPosts";
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
  // 日本時間 11/18 0:30 は、UTC では 11/17 15:30
  assert.equal(searchedToday("2026-11-17T15:30:00Z", "2026-11-18"), true);
  assert.equal(searchedToday("2026-11-17T14:59:00Z", "2026-11-18"), false);
  assert.equal(searchedToday("", "2026-11-18"), false);
  assert.equal(searchedToday("こわれた値", "2026-11-18"), false);
});

test("話題の投稿の検索: 遊び・毎日・収益化・リンク先も読み、1回に読む数は 検索の数 × 件数", () => {
  assert.equal(VIRAL_QUERIES.length, 7);
  assert.ok(VIRAL_QUERIES.some((q) => q.includes("ブラウザゲーム")));
  assert.ok(VIRAL_QUERIES.some((q) => q.includes("日替わり")));
  assert.ok(VIRAL_QUERIES.some((q) => q.includes("収益")));
  assert.ok(VIRAL_QUERIES.some((q) => q.includes("url:github.io")));
  // X の検索の言葉の長さの上限（512文字）に収まり、リポスト・返信は読まない
  for (const q of [...VIRAL_QUERIES, ...WANT_QUERIES]) assert.ok(q.length <= 512 && q.includes("-is:retweet") && q.includes("-is:reply"), q);
  assert.equal(searchReads({ viralPerQuery: 20, wantsPerQuery: 10 }), 7 * 20 + 3 * 10);
  assert.equal(searchReads({ viralPerQuery: 20, wantsPerQuery: 0 }), 140);
  // 初めの値: 話題の投稿は検索1つあたり20件、「欲しい」の声は10件
  const s = getSettings();
  assert.equal(s.viralPerQuery, 20);
  assert.equal(s.wantsPerQuery, 10);
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
    // 検索しない設定のときは、何もしない
    saveSettings({ viralSearch: false, lastViralSearch: last });
    await searchBeforeIdeas();
    assert.equal(calls.length, 0);
    saveSettings({ viralSearch: true });
    await searchBeforeIdeas();
    // 話題の投稿 7種類 × 20件 と、「欲しい」の声 3種類 × 10件。どれも前回の検索のあとから
    assert.equal(calls.length, VIRAL_QUERIES.length + WANT_QUERIES.length);
    assert.deepEqual(calls.map((u) => u.searchParams.get("max_results")), [...VIRAL_QUERIES.map(() => "20"), ...WANT_QUERIES.map(() => "10")]);
    assert.ok(calls.every((u) => u.searchParams.get("start_time") === last.replace(/\.\d{3}Z$/, "Z")));
    assert.deepEqual(calls.map((u) => u.searchParams.get("query")), [...VIRAL_QUERIES, ...WANT_QUERIES]);
    assert.ok(searchedToday(getSettings().lastViralSearch));
    // 同じ日の2回目は検索しない
    await searchBeforeIdeas();
    assert.equal(calls.length, VIRAL_QUERIES.length + WANT_QUERIES.length);
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
    saveSettings({ viralSearch: true, lastViralSearch: new Date(Date.now() - 3 * 86_400_000).toISOString() });
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
