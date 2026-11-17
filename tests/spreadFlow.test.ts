import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { aimBlocks, asksFirstChannel, createGate, getProject, liveCounts, maybeAutoJudge, newProjectBlock, resumeProject, spreadMadeToday, spreadResult, spreadRoom } from "../src/lib/loop";

const add = (opts: { stage?: string; aim?: string | null; publishedDaysAgo?: number; createdDaysAgo?: number } = {}) =>
  Number(db().prepare(`INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, published_at, created_at)
    VALUES ('t', 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', ?, ${opts.publishedDaysAgo === undefined ? "NULL" : `datetime('now', '-${opts.publishedDaysAgo} days')`}, datetime('now', '-${opts.createdDaysAgo ?? 0} days'))`)
    .run(opts.stage ?? "live", opts.aim === undefined ? "spread" : opts.aim).lastInsertRowid);
const metrics = (id: number, visits: number, plays: number, shares: number) =>
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, shares, ad_spend_jpy, source, lp_version) VALUES (?, date('now'), ?, ?, ?, 0, 'real', 1)").run(id, visits, plays, shares);
const reset = () => db().prepare("DELETE FROM projects").run();

test("広がる: 初めの値は 同時に7件・1日1本・3日で判定・当たりは遊んだ人20人かシェア3件", () => {
  const s = getSettings();
  assert.deepEqual([s.spreadMaxLive, s.spreadPerDay, s.spreadJudgeDays, s.spreadHitPlays, s.spreadHitShares, s.maxLive], [7, 1, 3, 20, 3, 2]);
});

test("広がる: 集客中の上限は、ほかのねらいと別に数える", () => {
  reset();
  add({ aim: "useful" });
  add({ aim: null }); // 前からある案件（ねらいなし）は、ほかのねらいとして数える
  add({ aim: "spread" });
  add({ aim: "spread", stage: "hold" });
  assert.deepEqual(liveCounts(), { normal: 2, spread: 1 });
  // ほかのねらいは上限（2件）なので作らないが、「広がる」は作れる
  const b = aimBlocks();
  assert.ok(b.useful && b.return && b.demand && !b.spread);
  assert.equal(newProjectBlock(), null);
  assert.equal(spreadRoom(), 6);
});

test("広がる: 毎日の自動は1日1本まで（人が頼んだときは1日の上限で止めない）。同時の上限も見る", () => {
  reset();
  add({ aim: "spread", stage: "rejected" }); // 今日作って見送ったものも数える
  assert.equal(spreadMadeToday(), 1);
  assert.match(aimBlocks({ daily: true }).spread ?? "", /今日の「広がる」の案件は、もう1件作りました/);
  assert.equal(aimBlocks().spread, undefined);
  assert.equal(spreadRoom({ daily: true }), 0);
  // 昨日の分は数えない
  reset();
  add({ aim: "spread", createdDaysAgo: 2 });
  assert.equal(spreadMadeToday(), 0);
  assert.equal(spreadRoom({ daily: true }), 1);
  // 同時の上限
  saveSettings({ spreadMaxLive: 1 });
  assert.match(aimBlocks().spread ?? "", /集客中の「広がる」の案件が1件で、上限（1件）/);
  assert.equal(spreadRoom(), 0);
  saveSettings({ spreadMaxLive: 7 });
});

test("広がる: 3日たつまでは判定しない。当たらなければ、承認なしで集客お休み（再開日なし・ページは公開のまま）", async () => {
  reset();
  const early = add({ publishedDaysAgo: 2 });
  metrics(early, 50, 3, 0);
  assert.equal(await maybeAutoJudge(early), false);
  assert.equal(getProject(early)!.stage, "live");

  const miss = add({ publishedDaysAgo: 4 });
  metrics(miss, 80, 19, 2);
  assert.deepEqual(spreadResult(getProject(miss)!), { plays: 19, shares: 2, hit: false });
  assert.equal(await maybeAutoJudge(miss), true);
  const p = getProject(miss)!;
  assert.equal(p.stage, "hold");
  assert.equal(p.hold_until, null);
  assert.match(p.hold_reason ?? "", /遊んだ人19人・シェア2件/);
  // 判断待ちは作らない
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM approvals WHERE project_id = ?").get(miss) as { n: number }).n, 0);
});

test("広がる: 遊んだ人かシェアのどちらかが基準以上なら当たり", () => {
  const a = add();
  metrics(a, 30, 20, 0);
  assert.equal(spreadResult(getProject(a)!).hit, true);
  const b = add();
  metrics(b, 10, 2, 3);
  assert.equal(spreadResult(getProject(b)!).hit, true);
});

test("広がる（PR #85 の ai-review の指摘）: 集客に戻したら、戻したあとの遊んだ人とシェアだけで次の判定をする", async () => {
  const id = add({ publishedDaysAgo: 4 });
  metrics(id, 80, 19, 2);
  assert.equal(await maybeAutoJudge(id), true);
  assert.equal(getProject(id)!.stage, "hold");
  // 戻したあとに1人だけ遊んでも、累計（20人）では当たりにしない
  resumeProject(id);
  metrics(id, 5, 1, 0);
  assert.deepEqual(spreadResult(getProject(id)!), { plays: 1, shares: 0, hit: false });
  // 戻したあと3日たったら、その分だけで判定して、またお休みにする
  db().prepare("UPDATE projects SET resumed_at = datetime('now', '-4 days') WHERE id = ?").run(id);
  assert.equal(await maybeAutoJudge(id), true);
  assert.match(getProject(id)!.hold_reason ?? "", /遊んだ人1人・シェア0件/);
});

test("広がる: 初めて公開したときに、最初の届け方を運営者に頼まない（ほかのねらいは今までどおり頼む）", () => {
  assert.equal(asksFirstChannel({ first_channel: "コミュニティに紹介（2か所）", aim: "spread" }), false);
  assert.equal(asksFirstChannel({ first_channel: "コミュニティに紹介（2か所）", aim: "useful" }), true);
  assert.equal(asksFirstChannel({ first_channel: "コミュニティに紹介（2か所）", aim: null }), true);
  assert.equal(asksFirstChannel({ first_channel: null, aim: "useful" }), false);
});

test("広がる（PR #85 の ai-review の指摘）: 案件を作る直前に上限を確かめ直し、作るたびに残りを減らす", () => {
  // 会議の前は「広がる」をあと2件作れた。会議の間に、お休みの1件を集客に戻して、残りは1件になった
  saveSettings({ spreadMaxLive: liveCounts().spread + 2, spreadPerDay: 100 });
  add({ aim: "spread", createdDaysAgo: 3 });
  const gate = createGate({ daily: true });
  assert.equal(gate("spread"), null);
  assert.match(gate("spread") ?? "", /今回作ってよい「広がる」の件数に達しています/);
  // ほかのねらいは、集客中の上限で確かめる
  saveSettings({ maxLive: 0 });
  assert.match(createGate()("useful") ?? "", /集客中の案件（「広がる」以外）/);
  saveSettings({ spreadMaxLive: 7, spreadPerDay: 1, maxLive: 2 });
});
