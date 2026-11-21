import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { launch } from "../src/lib/freePage";
import { db } from "../src/lib/db";
import { funnel, playDepth as depthOf } from "../src/lib/funnel";
import { funnelPeople } from "../src/lib/publish";
import { pickChampion } from "../src/lib/aims";
import { scoreChecks, type HitRow } from "../src/lib/hits";
import { playDepth, type DepthEvent } from "../lp-site/src/lp/playDepth";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";

// 運営者の問い（ゲーム系は別の軸で測ったほうがいいか）から、遊び系のツールの「遊びの深さ」を測ることにした（まずは見るだけ）
// 同じ問いで、アイデアを平均点だけで選ぶと尖った案が残らないので、推し枠と、採点の答え合わせを作った（運営者が「両方」と決めた）

test("遊びの深さ: 触ってから10秒のあいだ、画面に出ている秒数を遊んだ時間として数え、区切りを超えたら1度だけ知らせる", () => {
  const got: DepthEvent[] = [];
  const d = playDepth((e) => got.push(e));
  let now = 0;
  const run = (secs: number, visible = true) => { for (let i = 0; i < secs; i++) { now += 1000; d.tick(now, visible); } };
  run(20); // 触っていなければ数えない
  assert.deepEqual(got, []);
  d.active(now);
  run(10); // 触ってから10秒は数える
  run(5); // そのあとは数えない
  assert.deepEqual(got, []);
  for (let i = 0; i < 30; i++) { d.active(now); run(1); } // 触り続けると数える（10+30=40秒）
  assert.deepEqual(got, [{ name: "play_time", value: 15 }, { name: "play_time", value: 30 }]);
  d.active(now);
  run(5, false); // 画面に出ていない間は数えない
  run(5);
  assert.equal(got.length, 2);
});

test("遊びの深さ: 振った動き（持っているだけの揺れでなく）は、遊んでいるとみなす", () => {
  const got: DepthEvent[] = [];
  const d = playDepth((e) => got.push(e));
  let now = 0;
  d.motion(now, 0, -9.8, 0);
  for (let i = 0; i < 20; i++) { now += 1000; d.motion(now, 0.3, -9.6, 0.2); d.tick(now, true); } // 持っているだけ
  assert.deepEqual(got, []);
  for (let i = 0; i < 20; i++) { now += 1000; d.motion(now, i % 2 ? 12 : -12, -9.8, 0); d.tick(now, true); } // 振る
  assert.deepEqual(got, [{ name: "play_time", value: 15 }]);
});

test("遊びの深さ: 結果は続けて来た知らせを1回と数え、2回目から知らせる。結果の番号は種類の数を知らせる", () => {
  const got: DepthEvent[] = [];
  const d = playDepth((e) => got.push(e));
  d.result(0); d.result(100, 4); // labShare と labResult が続けて来ても1回
  d.result(5000, 4); // 2回目（同じ種類）
  d.result(9000, 7); // 3回目（新しい種類）
  d.result(9500); // 続けて来たので数えない
  assert.deepEqual(got, [
    { name: "result_kinds", value: 1 },
    { name: "results", value: 2 },
    { name: "results", value: 3 },
    { name: "result_kinds", value: 2 },
  ]);
});

test("遊びの深さ: 枠の中で触ったことを、1秒に1回まで active で知らせる", async (t) => {
  const browser = await launch();
  if (typeof browser === "string") return t.skip(browser);
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe id="f" sandbox="allow-scripts" style="width:300px;height:200px"></iframe><script>
      window.got = 0;
      addEventListener("message", function (e) { if (e.data && e.data.__lab === "active") window.got++; });
    </script>`);
    await page.locator("#f").evaluate((el, h) => { (el as HTMLIFrameElement).srcdoc = h; }, wrapToolHtml("<p>遊び</p>"));
    await page.waitForTimeout(300);
    for (let i = 0; i < 5; i++) await page.mouse.click(100, 100);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate("window.got"), 1);
    await page.waitForTimeout(1100);
    await page.mouse.click(100, 100);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate("window.got"), 2);
  } finally {
    await browser.close();
  }
});

test("遊びの深さ: 取り込みで、別の日にまた来た人を数え、案件の画面に区切りごとの人数と半分の人が遊んだ時間を出す", () => {
  const people = funnelPeople(
    [{ version: 2, visitor_id: "a", name: "play_time", detail: "15" }, { version: 2, visitor_id: "a", name: "play_time", detail: "15" }],
    [{ version: 2, visitor_id: "a", day: "2026-11-20" }, { version: 2, visitor_id: "a", day: "2026-11-21" }, { version: 2, visitor_id: "b", day: "2026-11-21" }, { version: 1, visitor_id: "b", day: "2026-11-20" }],
  );
  assert.deepEqual([...people.get("2|play_time|15")!], ["a"]);
  assert.deepEqual([...people.get("2|revisit|")!], ["a"]);
  assert.equal(people.get("1|revisit|"), undefined);

  const d = depthOf([
    { name: "play_time", detail: "15", visitors: 8 }, { name: "play_time", detail: "30", visitors: 5 }, { name: "play_time", detail: "60", visitors: 2 },
    { name: "results", detail: "2", visitors: 4 }, { name: "result_kinds", detail: "1", visitors: 6 }, { name: "result_kinds", detail: "3", visitors: 2 },
    { name: "revisit", detail: "", visitors: 3 },
  ], 10);
  assert.equal(d.halfTime, 30); // 10人のうち5人が30秒以上
  assert.deepEqual(d.kinds, [{ mark: 1, visitors: 6 }, { mark: 3, visitors: 2 }]);
  assert.equal(d.results[0].visitors, 4);
  assert.equal(d.revisit, 3);
  assert.equal(d.hasData, true);
  assert.equal(depthOf([{ name: "play_time", detail: "15", visitors: 1 }], 10).halfTime, null);

  // 動くツールの案件だけに出す。また来た人だけの記録では、ページの中の動きの記録があるとは言わない
  const add = (kind: string) => Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', ?)").run(kind).lastInsertRowid);
  const tool = add("tool");
  const lp = add("lp");
  for (const id of [tool, lp]) db().prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, 1, 'revisit', '', 2)").run(id);
  const p = (id: number) => db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as Parameters<typeof funnel>[0];
  assert.equal(funnel(p(tool), 1).play?.revisit, 2);
  assert.equal(funnel(p(tool), 1).hasEvents, false);
  assert.equal(funnel(p(lp), 1).play, null);
});

test("推し枠: 平均で漏れた案のうち、作者ではない会社のAIが8点以上を付けた案を選ぶ（点が同じなら評価の割れた案）", () => {
  const x = (name: string, top: number | null, avg: number) => ({ name, top, avg });
  assert.equal(pickChampion([x("a", 7, 6), x("b", null, 9)]), null); // 8点以上がない
  assert.equal(pickChampion([x("a", 8, 7.5), x("b", 9, 5), x("c", 9, 6)])?.name, "b"); // 9点で、平均との差が大きい方
  assert.equal(pickChampion([x("a", 9, 5), x("b", 8, 5)], (c) => c.name !== "a")?.name, "b"); // 作ってよい件数などで外れた案は飛ばす
});

test("採点の答え合わせ: 作者以外のAIが付けた点を、当たった案と当たらなかった案に分け、推し枠と平均の当たりを数える", () => {
  const conn = db();
  const project = () => Number(conn.prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  const [p1, p2, p3] = [project(), project(), project()];
  const cand = (pid: number | null, kind: string | null, author: string, practice = 0) =>
    Number(conn.prepare("INSERT INTO idea_candidates (batch_id, label, author_model, title, payload, project_id, pick_kind, practice) VALUES ('b', 'A', ?, 't', '{}', ?, ?, ?)").run(author, pid, kind, practice).lastInsertRowid);
  const score = (c: number, model: string, s: number) => conn.prepare("INSERT INTO idea_scores (candidate_id, scorer_model, score) VALUES (?, ?, ?)").run(c, model, s);
  const c1 = cand(p1, "average", "gpt");
  const c2 = cand(p2, "champion", "gpt");
  const c3 = cand(p3, "average", "gpt");
  const c4 = cand(null, null, "gpt", 1);
  score(c1, "claude", 8); score(c1, "gpt", 10); // 作者の点は数えない
  score(c2, "claude", 4);
  score(c3, "claude", 9); // 当たりがまだ分からない案件は数えない
  score(c4, "claude", 1); // 仮テストは数えない
  const row = (id: number, hit: boolean | null): HitRow => ({ id, title: "t", aim: "spread", genre: null, publishedDay: "2026-11-20", plays: 0, shares: 0, hit, followersGain: null });
  const r = scoreChecks([row(p1, true), row(p2, false), row(p3, null)]);
  const claude = r.scorers.find((s) => s.model === "claude")!;
  assert.deepEqual(claude, { model: "claude", hitN: 1, hitAvg: 8, missN: 1, missAvg: 4 });
  assert.equal(r.scorers.find((s) => s.model === "gpt"), undefined);
  assert.deepEqual(r.picks, [{ kind: "average", count: 2, judged: 1, hits: 1 }, { kind: "champion", count: 1, judged: 1, hits: 0 }]);
});
