import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { aimBlocks, asksFirstChannel, createGate, getProject, liveCounts, maybeAutoJudge, newProjectBlock, resumeProject, spreadJudgeAtMs, spreadMadeToday, spreadResult, spreadRoom } from "../src/lib/loop";

const add = (opts: { stage?: string; aim?: string | null; publishedDaysAgo?: number; createdDaysAgo?: number } = {}) =>
  Number(db().prepare(`INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, published_at, created_at)
    VALUES ('t', 't', 'p', 's', 'h', 'r', ?, 'claude', 'tool', ?, ${opts.publishedDaysAgo === undefined ? "NULL" : `datetime('now', '-${opts.publishedDaysAgo} days')`}, datetime('now', '-${opts.createdDaysAgo ?? 0} days'))`)
    .run(opts.stage ?? "live", opts.aim === undefined ? "spread" : opts.aim).lastInsertRowid);
const metrics = (id: number, visits: number, plays: number, shares: number) =>
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, shares, ad_spend_jpy, source, lp_version) VALUES (?, date('now'), ?, ?, ?, 0, 'real', 1)").run(id, visits, plays, shares);
const reset = () => db().prepare("DELETE FROM projects").run();

test("広がる: 初めの値は 同時に7件・1日1本・3日で判定・当たりは遊んだ人20人かシェア3件・判定に要る訪問は20人", () => {
  const s = getSettings();
  assert.deepEqual([s.spreadMaxLive, s.spreadPerDay, s.spreadJudgeDays, s.spreadHitPlays, s.spreadHitShares, s.maxLive, s.spreadMinVisits], [7, 1, 3, 20, 3, 2, 20]);
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
  // 判定の結果を残す（当たりから学ぶ）
  assert.equal(p.spread_hit, 0);
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
  metrics(id, 25, 1, 0);
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

test("広がる（提案箱 #105）: 朝会の試しが開いている間は、日数が過ぎても試しの判定日時まで判定しない（延ばしたあとも）", async () => {
  const id = add({ publishedDaysAgo: 4 });
  metrics(id, 30, 1, 0); // 訪問は下限（20人）以上（訪問が少ないときの延長は、提案箱 #106 のテストで見る）
  const trial = db().prepare(`INSERT INTO plan_trials (plan_id, project_id, created_at, question, change, metric, judge_at, hours, min_visits)
    VALUES (1, ?, datetime('now', '-1 hours'), 'Xで紹介すると利用が出るか', 'X夜に紹介', 'conversions', datetime('now', '+71 hours'), 72, 20)`).run(id).lastInsertRowid;
  assert.equal(await maybeAutoJudge(id), false);
  assert.equal(getProject(id)!.stage, "live");
  // 判定日時が過ぎても、延ばした（judge_at が先になった）なら待つ
  db().prepare("UPDATE plan_trials SET judge_at = datetime('now', '+24 hours'), extended = 1 WHERE id = ?").run(trial);
  assert.equal(await maybeAutoJudge(id), false);
  // 閉じた試しは見ない（判定日時がまだ先でも）
  db().prepare("UPDATE plan_trials SET status = 'expired' WHERE id = ?").run(trial);
  assert.equal(await maybeAutoJudge(id), true);
  assert.equal(getProject(id)!.stage, "hold");
});

test("広がる（提案箱 #105）: 試しの判定日時が過ぎたら、試しが開いたままでも判定する", async () => {
  const id = add({ publishedDaysAgo: 4 });
  metrics(id, 30, 1, 0);
  db().prepare(`INSERT INTO plan_trials (plan_id, project_id, created_at, question, change, metric, judge_at, hours, min_visits)
    VALUES (1, ?, datetime('now', '-73 hours'), 'q', 'c', 'conversions', datetime('now', '-1 hours'), 72, 20)`).run(id);
  assert.equal(await maybeAutoJudge(id), true);
  assert.equal(getProject(id)!.stage, "hold");
});

test("広がる（PR #225 の ai-review の指摘）: 公開が前回の判断より新しいときは、公開から数える", async () => {
  const id = add({ publishedDaysAgo: 1 });
  db().prepare("UPDATE projects SET judged_at = datetime('now', '-10 days') WHERE id = ?").run(id);
  metrics(id, 10, 1, 0);
  const p = getProject(id)!;
  const at = spreadJudgeAtMs(p)!;
  const published = Date.parse(`${p.published_at!.replace(" ", "T")}Z`);
  assert.equal(at, published + getSettings().spreadJudgeDays * 86_400_000);
  // 前回の判断から日数が過ぎていても、公開から日数がたつまでは判定しない
  assert.equal(await maybeAutoJudge(id), false);
  assert.equal(getProject(id)!.stage, "live");
  // 再開が公開より新しければ、再開から数える
  db().prepare("UPDATE projects SET resumed_at = datetime('now', '-12 hours') WHERE id = ?").run(id);
  const r = getProject(id)!;
  assert.equal(spreadJudgeAtMs(r), Date.parse(`${r.resumed_at!.replace(" ", "T")}Z`) + getSettings().spreadJudgeDays * 86_400_000);
});

test("広がる（PR #225 の ai-review の指摘）: 公開が前回の判断より新しい既存の案件は、遊んだ人・シェアも公開の日から数える", () => {
  const id = add({ publishedDaysAgo: 1 });
  // 前回の判断のときに覚えた累計（公開より前。覚えた日時は判断と同じ）
  db().prepare("UPDATE projects SET judged_at = datetime('now', '-10 days'), spread_base_plays = 2, spread_base_shares = 0, spread_base_at = datetime('now', '-10 days') WHERE id = ?").run(id);
  const ins = db().prepare("INSERT INTO metrics (project_id, day, visits, signups, shares, ad_spend_jpy, source, lp_version) VALUES (?, ?, 10, ?, ?, 0, 'real', 1)");
  const jst = (daysAgo: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(Date.now() - daysAgo * 86_400_000));
  ins.run(id, jst(12), 2, 0); // 前回の判断より前
  ins.run(id, jst(5), 15, 2); // 前回の判断と公開のあいだ（公開前の数字）
  ins.run(id, jst(0), 4, 1); // 公開のあと
  assert.deepEqual(spreadResult(getProject(id)!), { plays: 4, shares: 1, hit: false });
  // 覚えた日時のない前からの累計も、公開が起点なら数え直す
  db().prepare("UPDATE projects SET spread_base_at = NULL WHERE id = ?").run(id);
  assert.deepEqual(spreadResult(getProject(id)!), { plays: 4, shares: 1, hit: false });
  // 起点のあとに覚えた累計（判断・再開・公開のとき）は、そのまま使う
  db().prepare("UPDATE projects SET spread_base_plays = 20, spread_base_shares = 2, spread_base_at = datetime('now') WHERE id = ?").run(id);
  assert.deepEqual(spreadResult(getProject(id)!), { plays: 1, shares: 1, hit: false });
});

test("広がる（提案箱 #106）: 訪問が少ないうちは外れとせず、判定を1回だけ延ばす。延ばしても届かなければ、外れに数えずにお休み", async () => {
  const id = add({ publishedDaysAgo: 4 });
  metrics(id, 12, 1, 0);
  const at = spreadJudgeAtMs(getProject(id)!)!;
  // 1回目: 延ばして、集客は続ける（判断はしていないので false）
  assert.equal(await maybeAutoJudge(id), false);
  let p = getProject(id)!;
  assert.equal(p.stage, "live");
  assert.equal(p.spread_hit, null);
  assert.equal(spreadJudgeAtMs(p), at + getSettings().spreadJudgeDays * 86_400_000);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'spread-extend'").get(id));
  // 延ばした日数がたつまでは、判定しない
  assert.equal(await maybeAutoJudge(id), false);
  // 延ばした日数がたっても訪問が届かなければ、お休み（理由を書き分け、外れには数えない）
  db().prepare("UPDATE projects SET published_at = datetime('now', '-7 days'), spread_extended = datetime('now', '-7 days') WHERE id = ?").run(id);
  assert.equal(await maybeAutoJudge(id), true);
  p = getProject(id)!;
  assert.equal(p.stage, "hold");
  assert.equal(p.spread_hit, null);
  assert.match(p.hold_reason ?? "", /訪問が少なく（20人未満）判断できなかった/);
});

test("広がる（提案箱 #106）: 延ばしたあと訪問が届いて当たらなければ、外れとして数える", async () => {
  const id = add({ publishedDaysAgo: 4 });
  metrics(id, 12, 1, 0);
  assert.equal(await maybeAutoJudge(id), false);
  db().prepare("UPDATE projects SET published_at = datetime('now', '-7 days'), spread_extended = datetime('now', '-7 days') WHERE id = ?").run(id);
  metrics(id, 15, 2, 0);
  assert.equal(await maybeAutoJudge(id), true);
  const p = getProject(id)!;
  assert.equal(p.spread_hit, 0);
  assert.match(p.hold_reason ?? "", /6日で訪問27人・遊んだ人3人/);
});

test("広がる（提案箱 #106）: 下限が0なら延ばさない", async () => {
  saveSettings({ spreadMinVisits: 0 });
  const id = add({ publishedDaysAgo: 4 });
  metrics(id, 3, 0, 0);
  assert.equal(await maybeAutoJudge(id), true);
  assert.equal(getProject(id)!.spread_hit, 0);
  saveSettings({ spreadMinVisits: 20 });
});

test("広がる（PR #228 のレビューの指摘）: 前回の判定の結果が残っていても、訪問が少なくて延ばす・お休みにするときは、結果を空に戻す", async () => {
  for (const prev of [1, 0]) {
    const id = add({ publishedDaysAgo: 4 });
    // 前の起点で判定した結果と、前の起点で延ばした記録が残っている（そのあと公開し直して、起点が変わった）
    db().prepare("UPDATE projects SET spread_hit = ?, spread_extended = datetime('now', '-30 days') WHERE id = ?").run(prev, id);
    metrics(id, 12, 1, 0);
    // 延ばすとき
    assert.equal(await maybeAutoJudge(id), false);
    assert.equal(getProject(id)!.stage, "live");
    assert.equal(getProject(id)!.spread_hit, null);
    // 延ばしたあとに結果が入っていても（ほかの経路で書かれても）、延ばしたあとも訪問が届かずにお休みにするときは空にする
    db().prepare("UPDATE projects SET spread_hit = ?, published_at = datetime('now', '-7 days'), spread_extended = datetime('now', '-7 days') WHERE id = ?").run(prev, id);
    assert.equal(await maybeAutoJudge(id), true);
    const p = getProject(id)!;
    assert.equal(p.stage, "hold");
    assert.equal(p.spread_hit, null);
  }
});
