import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { aiPaused } from "../src/lib/ai";
import { backfillViralApps, drainQueue, queueViral, resumeViralQueue } from "../src/lib/viralPosts";
import { queueRefs, resumeRefQueue } from "../src/lib/designRefs";

// 提案箱 #85: 緊急停止・予算の上限の間に、話題の投稿とデザインの参考の待ちを「失敗」にして捨てない

const g = globalThis as { __aiLabViralQueue?: boolean; __aiLabRefQueue?: boolean };
const idle = async () => {
  for (let i = 0; i < 100 && (g.__aiLabViralQueue || g.__aiLabRefQueue); i++) await new Promise((ok) => setTimeout(ok, 10));
};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
const viralStatus = (id: string) => (db().prepare("SELECT status, error FROM viral_posts WHERE tweet_id = ?").get(id) as { status: string; error: string | null });

test("緊急停止の間は、話題の投稿もデザインの参考も始めず、待ちのまま残る（本文も読みに行かない）", async () => {
  const before = getSettings().killSwitch;
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; return json({ message: "NOT_FOUND" }, 404); }) as typeof fetch;
  try {
    saveSettings({ killSwitch: true });
    assert.equal(aiPaused(), true);
    assert.equal(queueViral(["https://x.com/a/status/900000000000008501"]), 1);
    assert.equal(queueRefs(["https://example.com/lp-85"]), 1);
    resumeViralQueue();
    resumeRefQueue();
    await idle();
    assert.equal(fetched, 0);
    assert.deepEqual(viralStatus("900000000000008501"), { status: "queued", error: null });
    assert.deepEqual(db().prepare("SELECT status, error FROM design_refs WHERE url = ?").get("https://example.com/lp-85"), { status: "queued", error: null });
    // 止まっている間は、まとめを待たずにすぐ戻る
    const t = Date.now();
    await drainQueue(5000);
    assert.ok(Date.now() - t < 500, `待った時間 ${Date.now() - t}ms`);
  } finally {
    globalThis.fetch = realFetch;
    saveSettings({ killSwitch: before });
    db().prepare("DELETE FROM viral_posts").run();
    db().prepare("DELETE FROM design_refs").run();
  }
});

test("まとめの途中で緊急停止になって GuardError が出ても、失敗にせず待ちのまま残る", async () => {
  const before = getSettings().killSwitch;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    // 本文を読んでいる間に、運営者が緊急停止を押した
    saveSettings({ killSwitch: true });
    return json({ tweet: { text: "ゲーム作りました", likes: 100, author: { screen_name: "someone" } } });
  }) as typeof fetch;
  try {
    saveSettings({ killSwitch: false });
    assert.equal(queueViral(["https://x.com/a/status/900000000000008502"]), 1);
    await idle();
    assert.deepEqual(viralStatus("900000000000008502"), { status: "queued", error: null });
  } finally {
    globalThis.fetch = realFetch;
    saveSettings({ killSwitch: before });
    db().prepare("DELETE FROM viral_posts").run();
  }
});

test("予算の上限に達している間は、アプリの説明の後付けを呼ばない（エラーにしない）", async () => {
  const before = getSettings().monthlyBudgetJpy;
  try {
    db().prepare("INSERT INTO viral_posts (tweet_id, url, source, status, text, analysis) VALUES (?, ?, 'search', 'ok', ?, ?)")
      .run("900000000000008503", "https://x.com/i/web/status/900000000000008503", "ツール作りました", JSON.stringify({ genre: "遊び", format: "診断", hook: "", visual: "", why: "", takeaway: "", angle: "" }));
    saveSettings({ monthlyBudgetJpy: 0 });
    assert.equal(aiPaused(), true);
    assert.equal(await backfillViralApps(), 0);
  } finally {
    saveSettings({ monthlyBudgetJpy: before });
    db().prepare("DELETE FROM viral_posts").run();
  }
});
