import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { followerHistory, hitGroups, hitRows, hitsText, maybeRecordFollowers } from "../src/lib/hits";
import { jstToday } from "../src/lib/loop";

const X_ENV = { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts" };
const dayAgo = (n: number) => new Date(Date.parse(`${jstToday()}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

test("フォロワー数: 1日1回だけ X から読んで記録する（キーがなければ読まない。失敗してもその日はもう読まない）", async () => {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  let fail = false;
  globalThis.fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return fail
      ? new Response(JSON.stringify({ title: "Unauthorized" }), { status: 401 })
      : new Response(JSON.stringify({ data: { public_metrics: { followers_count: 123 } } }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal(await maybeRecordFollowers(), null);
    assert.equal(calls.length, 0);
    Object.assign(process.env, X_ENV);
    assert.equal(await maybeRecordFollowers(), 123);
    assert.ok(calls[0].startsWith("https://api.x.com/2/users/me"));
    assert.deepEqual(followerHistory().at(-1), { day: jstToday(), followers: 123 });
    // 同じ日の2回目は読まない
    assert.equal(await maybeRecordFollowers(), null);
    assert.equal(calls.length, 1);
    // 失敗しても、その日はもう読まない
    saveSettings({ lastFollowersTry: "" });
    fail = true;
    await assert.rejects(maybeRecordFollowers(), /フォロワー数を読めません/);
    assert.equal(getSettings().lastFollowersTry, jstToday());
    assert.equal(await maybeRecordFollowers(), null);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(X_ENV)) delete process.env[k];
  }
});

test("当たりの記録: ねらい・ジャンルごとに、遊んだ人・シェア・当たり・公開から3日のフォロワーの増えをまとめる", () => {
  db().prepare("DELETE FROM account_stats").run();
  // 公開の日は、日本時間の日付で決める（published_at は UTC の datetime('now', '-N days')）
  const jstDay = (n: number) => new Date(Date.now() - n * 86_400_000 + 9 * 3_600_000).toISOString().slice(0, 10);
  const add = (aim: string, genre: string | null, publishedDaysAgo: number, extra: { spread_hit?: number | null; stage?: string; growth_phase?: number } = {}) =>
    Number(db().prepare(`INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, genre, published_at, spread_hit, growth_phase)
      VALUES (?, 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', ?, ?, datetime('now', ?), ?, ?)`)
      .run(`${aim}-${genre}-${publishedDaysAgo}`, extra.stage ?? "live", aim, genre, `-${publishedDaysAgo} days`, extra.spread_hit ?? null, extra.growth_phase ?? 0).lastInsertRowid);
  const metrics = (id: number, plays: number, shares: number) =>
    db().prepare("INSERT INTO metrics (project_id, day, visits, signups, shares, ad_spend_jpy, source, lp_version) VALUES (?, date('now'), ?, ?, ?, 0, 'real', 1)").run(id, plays * 2, plays, shares);
  const a = add("spread", "ガチャ・診断", 10, { spread_hit: 1 });
  metrics(a, 40, 5);
  const b = add("spread", "ガチャ・診断", 6, { spread_hit: 0 });
  metrics(b, 3, 0);
  const c = add("useful", "計算・変換", 5, { growth_phase: 1 });
  metrics(c, 30, 1);
  add("spread", "手ざわり", 1); // まだ判定していない
  add("useful", null, 200); // 90日より前は数えない
  // フォロワー: a の公開の前の日に100、3日後に130（この日は b の公開の前の日でもある）。b は3日後の記録がない（読めなかった日）
  const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  db().prepare("INSERT INTO account_stats (day, platform, followers) VALUES (?, 'x', 100), (?, 'x', 130)").run(shift(jstDay(10), -1), shift(jstDay(10), 3));

  const rows = hitRows();
  assert.equal(rows.length, 4);
  const ra = rows.find((r) => r.id === a)!;
  assert.deepEqual([ra.plays, ra.shares, ra.hit, ra.followersGain], [40, 5, true, 30]);
  // その日ちょうどの記録がなければ、ほかの日の数で埋めずに「測れなかった」（PR #88 の ai-review の指摘）
  assert.equal(rows.find((r) => r.id === b)!.followersGain, null);
  // 3日たっていない案件は、フォロワーの増えをまだ測らない
  assert.equal(rows.find((r) => r.genre === "手ざわり")!.followersGain, null);
  assert.equal(rows.find((r) => r.id === c)!.hit, true);

  const groups = hitGroups(rows);
  const gacha = groups.find((g) => g.genre === "ガチャ・診断")!;
  assert.deepEqual([gacha.count, gacha.judged, gacha.hits, gacha.plays, gacha.shares], [2, 2, 1, 43, 5]);
  // 当たりの多い順
  assert.equal(groups[0].genre, "ガチャ・診断");

  const text = hitsText();
  assert.match(text, /広がる・ガチャ・診断: 2件（判定済み2件のうち当たり1件）/);
  assert.match(text, /3割以上は、まだ試していないジャンル/);
});

test("フォロワー数の記録: 直近14日は、記録の件数ではなく日付で絞る（PR #88 の ai-review の指摘）", () => {
  db().prepare("DELETE FROM account_stats").run();
  db().prepare("INSERT INTO account_stats (day, platform, followers) VALUES (?, 'x', 1), (?, 'x', 2), (?, 'x', 3)").run(dayAgo(40), dayAgo(13), dayAgo(0));
  assert.deepEqual(followerHistory(14).map((f) => f.followers), [2, 3]);
});

test("当たりの記録（PR #88 の2回目の ai-review の指摘）: アイデア出しには、すべてのねらい・ジャンルの組を渡す。育てる段階に入ったら、そのあと撤退しても当たり", () => {
  for (let i = 0; i < 25; i++) {
    db().prepare(`INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, genre, published_at, spread_hit)
      VALUES (?, 't', 'p', 's', 'h', 'r', 'hold', 'claude', 'tool', 'spread', ?, datetime('now', '-5 days'), 0)`).run(`外れ${i}`, `外れジャンル${i}`);
  }
  const text = hitsText();
  assert.match(text, /外れジャンル0:/);
  assert.match(text, /外れジャンル24:/);
  const id = Number(db().prepare(`INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, genre, published_at, growth_phase)
    VALUES ('育ってから撤退', 't', 'p', 's', 'h', 'r', 'killed', 'claude', 'tool', 'useful', '計算', datetime('now', '-20 days'), 1)`).run().lastInsertRowid);
  assert.equal(hitRows().find((r) => r.id === id)!.hit, true);
});
