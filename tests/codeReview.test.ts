import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { REVIEW_MAX, addReviewFindings, reviewContext, reviewTokenOk } from "../src/lib/codeReview";
import { GET, POST } from "../src/app/api/code-review/route";
import { mergeSimilarOpen } from "../src/lib/voices";
import { scoringExisting } from "../src/lib/weekly";
import { showcaseRoutineStats } from "../src/lib/showcase";

const TOKEN = "r".repeat(40);
process.env.LAB_REVIEW_TOKEN = TOKEN;
const auth = { authorization: `Bearer ${TOKEN}` };
const clear = () => db().prepare("DELETE FROM plan_requests").run();
const TOPICS: [string, string, string][] = [
  ["来訪者の案件の画面で下書きの版が見える", "src/app/projects/[id]/page.tsx で guest のとき版の一覧を伏せる", "page.tsx の版の一覧が guest でも出ることを読んだ"],
  ["予算の上限を通らずに画像を描く道", "src/lib/illustration.ts の描き直しで monthSpendUsd を確かめる", "描き直しのボタンから上限の確かめを通らないことを読んだ"],
  ["取り込みの失敗が記録に残らない", "src/lib/publish.ts の syncRealMetrics で失敗を events に書く", "catch で捨てていて通知もないことを読んだ"],
  ["設定の夜間停止が使われていない", "src/lib/scheduler.ts で quietHours を見て投稿を止める", "設定の値を読む所がどこにもないことを確かめた"],
  ["週のまとめの集計で日付がずれる", "src/lib/weekly.ts の集計を日本時間の0時からにそろえる", "UTC の日付で切っていることを読んだ"],
  ["動画の台本の検証にテストがない", "tests に playVideo の台本の確かめのテストを足す", "台本の形を確かめる関数にテストがないことを確かめた"],
  ["ツールのエラーの通知が重なる", "src/lib/funnel.ts の通知を1日1回にまとめる", "同じエラーで毎回通知していることを読んだ"],
  ["議事録に話した社員の名前が出ない", "src/lib/meetings.ts の議事録の各発言に、話した社員の名前を付ける", "議事録の本文に発言者がなく、誰の意見か分からないことを確かめた"],
  ["評価が再起動のあと実行中のまま残る", "src/lib/runner.ts で起動したときに古い running を閉じる", "runs の status を閉じる処理がないことを確かめた"],
  ["公開サイトの一覧の並びが毎回変わる", "lp-site/src/app/page.tsx の並びを公開した日の新しい順に固定する", "読み込むたびに並びが入れ替わることを確かめた"],
];
const item = (n: number) => ({ title: TOPICS[n - 1][0], how: TOPICS[n - 1][1], why: TOPICS[n - 1][2] });

test("コードの見直し: 合言葉は Bearer で、32文字以上の同じ値のときだけ通す", () => {
  assert.equal(reviewTokenOk(`Bearer ${TOKEN}`), true);
  assert.equal(reviewTokenOk(TOKEN), false);
  assert.equal(reviewTokenOk(`Bearer ${TOKEN}x`), false);
  assert.equal(reviewTokenOk(null), false);
  const keep = process.env.LAB_REVIEW_TOKEN;
  process.env.LAB_REVIEW_TOKEN = "short";
  assert.equal(reviewTokenOk("Bearer short"), false);
  process.env.LAB_REVIEW_TOKEN = keep;
});

test("コードの見直し: 仕組みの改善として、出どころ「コードの見直し」で入れ、同じ提案は入れない", () => {
  clear();
  const r = addReviewFindings([item(1)]);
  assert.equal(r.added.length, 1);
  const row = db().prepare("SELECT target, source, scene, proposer, how, why FROM plan_requests WHERE id = ?").get(r.added[0]) as Record<string, string | null>;
  assert.deepEqual(row, { target: "system", source: "review", scene: "コードの見直し", proposer: null, how: item(1).how, why: item(1).why });
  const again = addReviewFindings([item(1)]);
  assert.equal(again.added.length, 0);
  assert.match(again.skipped[0], /同じ題か同じ趣旨/);
});

test("コードの見直し: 1回に4件まで（11/27 に運営者が、週2回・8件から毎日・4件にした）。形のおかしいものは入れずに理由を返す", () => {
  clear();
  const first = addReviewFindings([item(1), item(2)]);
  assert.equal(first.added.length, 2);
  const bad = addReviewFindings([{ title: "題だけ" }, { title: "x".repeat(81), how: "h", why: "w" }]);
  assert.equal(bad.added.length, 0);
  assert.equal(bad.skipped.length, 2);
  assert.equal(REVIEW_MAX, 4);
  const rest = addReviewFindings([4, 5, 6].map(item));
  assert.equal(rest.added.length, REVIEW_MAX - 2);
  assert.match(rest.skipped.at(-1)!, /4件を超えた/);
  // 7日前に入ったものは数えない
  db().prepare("UPDATE plan_requests SET created_at = datetime('now', '-7 days') WHERE source = 'review'").run();
  assert.equal(addReviewFindings([item(10)]).added.length, 1);
  assert.throws(() => addReviewFindings("not array"));
});

test("コードの見直し: 一度に送れるのは4件まで（超えた分は読まない）", () => {
  clear();
  const r = addReviewFindings([1, 2, 3, 4, 5, 6].map(item));
  assert.equal(r.added.length, 4);
  assert.match(r.skipped.at(-1)!, /2件/);
});

test("コードの見直し: 入口は合言葉がないと 401。読むと仕組みの改善が返り、送ると入る", async () => {
  clear();
  db().prepare("INSERT INTO plan_requests (title, how, source, target) VALUES ('あなたへのお願い', 'h', 'plan', 'human'), ('仕組みの提案', 'h', 'scene', 'system')").run();
  assert.equal((await GET(new Request("http://x/api/code-review"))).status, 401);
  assert.equal((await POST(new Request("http://x/api/code-review", { method: "POST", body: "{}" }))).status, 401);
  const got = (await (await GET(new Request("http://x/api/code-review", { headers: auth }))).json()) as { proposals: { title: string }[] };
  assert.deepEqual(got.proposals.map((p) => p.title), ["仕組みの提案"]);
  const res = await POST(new Request("http://x/api/code-review", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ items: [item(1)] }) }));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { added: number[] }).added.length, 1);
  assert.equal((await POST(new Request("http://x/api/code-review", { method: "POST", headers: auth, body: JSON.stringify({ items: "x" }) }))).status, 400);
  assert.equal(reviewContext().length, 2);
});

test("コードの見直し: 上限に達したあとも、同じ趣旨の提案が返事待ちなら「何回出たか」を数える", () => {
  clear();
  const first = addReviewFindings([1, 2, 3, 4].map(item));
  assert.equal(first.added.length, 4);
  const target = first.added[0];
  const near = { ...item(1), title: "来訪者の案件の画面で、下書きの版が見えてしまう" };
  const r = addReviewFindings([near, item(9)]);
  assert.equal(r.added.length, 0);
  assert.match(r.skipped[0], /同じ題か同じ趣旨/);
  assert.match(r.skipped[1], /4件を超えた/);
  assert.equal((db().prepare("SELECT repeats FROM plan_requests WHERE id = ?").get(target) as { repeats: number }).repeats, 1);
});

test("コードの見直し: 入れた提案は、定例会議で採点しない（運営者が見る前に低い点で見送りにならないように）", () => {
  clear();
  const [reviewId] = addReviewFindings([item(1)]).added;
  const sceneId = Number(db().prepare("INSERT INTO plan_requests (title, how, source, target) VALUES ('仕組みの提案', 'h', 'scene', 'system')").run().lastInsertRowid);
  const ids = scoringExisting().map((r) => r.id);
  assert.ok(ids.includes(sceneId));
  assert.ok(!ids.includes(reviewId));
});

test("コードの見直し: 入れた提案は、似た提案をまとめるときに消さない", () => {
  clear();
  const [reviewId] = addReviewFindings([item(1)]).added;
  // 似た提案が、ふだんの作業の途中で先に入っていた（点も付いている）
  const other = Number(db().prepare("INSERT INTO plan_requests (title, how, source, target, score) VALUES (?, ?, 'scene', 'system', 9)").run("来訪者の案件の画面で、下書きの版が見える", item(1).how).lastInsertRowid);
  assert.equal(mergeSimilarOpen(true), 1);
  const left = (db().prepare("SELECT id, repeats FROM plan_requests ORDER BY id").all() as { id: number; repeats: number }[]);
  assert.deepEqual(left, [{ id: reviewId, repeats: 1 }]);
  assert.ok(other);
});

test("コードの見直し: 概要ページに、見直しで入った数・頼んだ数・マージされた数を出す", () => {
  clear();
  const [a, b] = addReviewFindings([item(1), item(2)]).added;
  db().prepare("INSERT INTO plan_requests (title, how, source, target, ai_fix_at, ai_fix_pr_state) VALUES ('仕組みの提案', 'h', 'scene', 'system', datetime('now'), 'merged')").run();
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now'), ai_fix_pr_state = 'merged' WHERE id = ?").run(a);
  const r = showcaseRoutineStats();
  assert.deepEqual([r.reviewed, r.reviewAsked, r.reviewMerged], [2, 1, 1]);
  assert.deepEqual([r.asked, r.merged], [2, 2]);
  assert.ok(b);
});

test("コードの見直し: 読む提案は件数で切らない", () => {
  clear();
  const ins = db().prepare("INSERT INTO plan_requests (title, how, source, target) VALUES (?, 'h', 'scene', 'system')");
  for (let i = 0; i < 90; i++) ins.run(`仕組みの提案 ${i}`);
  assert.equal(reviewContext().length, 90);
});
