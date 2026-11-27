import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings } from "../src/lib/db";
import { placeTypeStats, postStatsText } from "../src/lib/postStats";
import { postAllowed, xPlayPromoLeft } from "../src/lib/snsApi";
import { xPlayReviewText } from "../src/lib/weekly";
import { attributePosts } from "../src/lib/sns";
import { trackedInApp } from "../lp-site/src/lp/inApp";

const project = (kind: string, aim: string | null) =>
  Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'm', ?, ?)").run(kind, aim).lastInsertRowid);
let code = 0;
const post = (pid: number, platform: string, visits: number, conversions: number, ago = "-1 days") =>
  db().prepare("INSERT INTO sns_posts (project_id, platform, code, text, status, author, posted_at, post_url, visits, conversions) VALUES (?, ?, ?, '本文', 'posted', 'ai', datetime('now', ?), ?, ?, ?)")
    .run(pid, platform, `c${++code}`, ago, `https://example.com/${code}`, visits, conversions);

test("宣伝の成績を、場所×案件の型ごとに、訪問・登録・利用・利用率・1件あたりの費用でまとめる", () => {
  saveSettings({ usdJpy: 150 });
  const play = project("tool", "spread");
  const useful = project("tool", "useful");
  const lp = project("lp", "demand");
  post(play, "x", 1, 1);
  post(play, "x", 1, 1);
  post(play, "threads", 4, 0);
  post(useful, "threads", 2, 1);
  post(lp, "bluesky", 3, 1);
  post(play, "threads", 5, 1, "-30 days"); // 直近14日には入らない

  const rows = placeTypeStats(14);
  const xPlay = rows.find((r) => r.platform === "x" && r.type === "play")!;
  assert.deepEqual({ n: xPlay.n, visits: xPlay.visits, uses: xPlay.uses, signups: xPlay.signups, rate: xPlay.rate, costJpy: xPlay.costJpy, costPer: xPlay.costPer }, { n: 2, visits: 2, uses: 2, signups: 0, rate: 1, costJpy: 60, costPer: 30 });
  const thPlay = rows.find((r) => r.platform === "threads" && r.type === "play")!;
  assert.equal(thPlay.n, 1);
  assert.equal(thPlay.rate, 0);
  assert.equal(thPlay.costJpy, 0);
  const lpRow = rows.find((r) => r.type === "lp")!;
  assert.equal(lpRow.signups, 1);
  assert.equal(lpRow.uses, 0);
  assert.equal(placeTypeStats().find((r) => r.platform === "threads" && r.type === "play")!.n, 2);

  const text = postStatsText();
  assert.match(text, /直近14日:\n- X×遊ぶツール: 投稿2件・訪問2人（平均1.0人）・登録0・利用2・利用率100%・1件あたりの費用 約30円/);
  assert.match(text, /Threads×遊ぶツール: 投稿1件・訪問4人.*利用率0%・1件あたりの費用 0円（無料）/);
  assert.match(text, /Bluesky×事前登録LP: 投稿1件・訪問3人（平均3.0人）・登録1・利用0/);
});

test("X の宣伝を止めていても、設定がオンなら遊ぶツールだけ直近7日で3件まで宣伝してよい", () => {
  db().prepare("DELETE FROM sns_posts").run();
  const play = project("tool", "return");
  const useful = project("tool", "useful");
  saveSettings({ promoOff: "x", xPlayPromo: false });
  assert.equal(postAllowed("x", "promo", play), false);
  assert.equal(postAllowed("threads", "promo", play), true);

  saveSettings({ xPlayPromo: true });
  assert.equal(postAllowed("x", "promo", play), true);
  assert.equal(postAllowed("x", "promo", useful), false);
  assert.equal(postAllowed("x", "promo"), false); // 案件の分からない投稿（決まった間隔の自動投稿）は止めたまま
  assert.equal(postAllowed("x", "plain", play), true);
  assert.equal(xPlayPromoLeft(), 3);

  post(play, "x", 0, 0);
  post(play, "x", 0, 0);
  post(play, "x", 0, 0, "-8 days"); // 7日より前は数えない
  assert.equal(xPlayPromoLeft(), 1);
  post(play, "x", 0, 0);
  assert.equal(xPlayPromoLeft(), 0);
  assert.equal(postAllowed("x", "promo", play), false);

  // X の宣伝を止めていなければ、例外は関係ない
  saveSettings({ promoOff: "" });
  assert.equal(postAllowed("x", "promo", useful), true);
  assert.equal(xPlayPromoLeft(), 0);
  saveSettings({ xPlayPromo: false });
});

test("再開から14日たったら、週の定例会議に場所ごとの利用数を出す", () => {
  const since = Date.parse("2026-11-01T00:00:00Z");
  saveSettings({ xPlayPromo: false, xPlayPromoSince: new Date(since).toISOString() });
  assert.equal(xPlayReviewText(since + 20 * 86_400_000), "");
  saveSettings({ xPlayPromo: true });
  assert.equal(xPlayReviewText(since + 13 * 86_400_000), "");
  const t = xPlayReviewText(since + 14 * 86_400_000);
  assert.match(t, /2026-11-01から14日/);
  assert.match(t, /場所ごとの直近14日の宣伝の成績:\n- X: 宣伝\d+件/);
  assert.match(t, /続けるか止めるかを決める/);
  saveSettings({ xPlayPromo: false });
});

// 提案箱 #108: Threads×遊ぶツールの利用0が、アプリの中のブラウザとそれ以外のどちらで起きているかを、朝会の材料に出す
test("訪問の記録の inapp から、投稿ごとにアプリの中のブラウザの人と利用を数え、宣伝の成績に割合を出す", () => {
  db().prepare("DELETE FROM sns_posts").run();
  const play = project("tool", "spread");
  post(play, "threads", 0, 0);
  const th = `c${code}`;
  post(play, "x", 0, 0);
  const x = `c${code}`;
  const views = [
    { visitor_id: "a", source: th, inapp: "other" },
    { visitor_id: "a", source: th, inapp: "" }, // 別の日にアプリの外で開いても、アプリの中で開いた人として数える
    { visitor_id: "b", source: th, inapp: "other" },
    { visitor_id: "c", source: th, inapp: "" },
    { visitor_id: "d", source: th, inapp: null }, // 列を足す前の訪問は、見分けられない
    { visitor_id: "e", source: x, inapp: "x" },
  ];
  attributePosts(play, views, [{ visitor_id: "c" }, { visitor_id: "e" }]);
  const r = db().prepare("SELECT visits, conversions, inapp_known, known_conversions, inapp_visits, inapp_conversions FROM sns_posts WHERE code = ?").get(th);
  assert.deepEqual({ ...(r as object) }, { visits: 4, conversions: 1, inapp_known: 3, known_conversions: 1, inapp_visits: 2, inapp_conversions: 0 });

  const text = postStatsText();
  assert.match(text, /Threads×遊ぶツール: 投稿1件・訪問4人.*・アプリの中のブラウザ 2\/3人（67%。登録・利用 0）・それ以外 1人（登録・利用 1）/);
  assert.match(text, /X×遊ぶツール: .*・アプリの中のブラウザ 1\/1人（100%。登録・利用 1）・それ以外 0人（登録・利用 0）/);

  // 見分けられた訪問がないときは、割合を出さない
  attributePosts(play, views.map((v) => ({ ...v, inapp: null })), []);
  assert.doesNotMatch(postStatsText(), /アプリの中のブラウザ \d/);
});

test("公開サイトの訪問の記録に入れる inapp は、決まった種類か空だけ（それ以外・届かないときは入れない）", () => {
  assert.equal(trackedInApp("x"), "x");
  assert.equal(trackedInApp("other"), "other");
  assert.equal(trackedInApp(""), "");
  assert.equal(trackedInApp("threads"), null);
  assert.equal(trackedInApp(undefined), null);
  assert.equal(trackedInApp(1), null);
});
