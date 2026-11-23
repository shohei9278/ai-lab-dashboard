import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { exploreDone, exploreSlots, exploreStats, exploreStatsText, madeGenres } from "../src/lib/explore";

test("実験枠: 直近7日と合わせて出す案の1割（切り捨て）、少なくとも1件", () => {
  // その週の最初の回は、少なくとも1件
  assert.equal(exploreSlots(6, { ideas: 0, explore: 0 }), 1);
  // 1割に届いていれば足さない
  assert.equal(exploreSlots(6, { ideas: 6, explore: 1 }), 0);
  assert.equal(exploreSlots(6, { ideas: 12, explore: 1 }), 0);
  // 24件で2件目
  assert.equal(exploreSlots(6, { ideas: 18, explore: 1 }), 1);
  // 足りない分が今回の枠より多くても、今回の枠まで
  assert.equal(exploreSlots(2, { ideas: 100, explore: 0 }), 2);
  assert.equal(exploreSlots(0, { ideas: 0, explore: 0 }), 0);
});

test("実験枠: 案の数・作ったジャンル・成績を、実験枠とふつうの枠で分けて数える", () => {
  const ins = db().prepare("INSERT INTO idea_candidates (batch_id, label, author_model, title, payload, avg_score, practice, explore) VALUES ('b', 'A', 'm', 't', '{}', ?, ?, ?)");
  ins.run(6, 0, 0);
  ins.run(4, 0, 0);
  ins.run(8, 0, 1);
  ins.run(9, 1, 1); // 見るだけの案は数えない
  assert.deepEqual(exploreDone(), { ideas: 3, explore: 1 });

  const pj = db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, genre, explore, public_slug) VALUES ('t', 't', 'p', 's', 'h', 'r', ?, 'm', 'tool', ?, ?, ?)");
  const e = Number(pj.run("live", "なりきり", 1, "e1").lastInsertRowid);
  pj.run("killed", "診断", 0, null);
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, '2026-11-01', 20, 5, 'real')").run(e);
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, '2026-11-02', 100, 50, 'simulated')").run(e);
  assert.deepEqual(madeGenres(), ["なりきり", "診断"]);

  const st = exploreStats();
  assert.equal(st.explore.ideas, 1);
  assert.equal(st.explore.avgScore, 8);
  assert.equal(st.explore.projects, 1);
  assert.equal(st.explore.published, 1);
  assert.equal(st.explore.visits, 20); // 試しの数字は入れない
  assert.equal(st.explore.conversions, 5);
  assert.equal(st.normal.ideas, 2);
  assert.equal(st.normal.avgScore, 5);
  assert.equal(st.normal.killed, 1);
  const text = exploreStatsText();
  assert.match(text, /- 実験枠: 案 1件（平均 8\.0点）・案件 1件・公開 1件・訪問 20人・登録や利用 5人（25\.0%）/);
  assert.match(text, /- ふつうの枠: 案 2件（平均 5\.0点）・案件 1件・公開 0件・訪問 0人・登録や利用 0人（—%）・続ける 0件・撤退 1件/);
});
