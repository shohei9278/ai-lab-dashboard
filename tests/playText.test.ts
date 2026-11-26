import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, type ProjectRow } from "../src/lib/db";
import { funnelText, PLAY_FEW_USERS, playDepth, playText } from "../src/lib/funnel";
import { jstDay } from "../src/lib/sns";

// 遊びの深さを、案件のねらいに合わせた見方と一緒に、AIの判断の材料に渡す（11/26 に運営者が決めた）
// 遊び系は遊び続けたか・繰り返したか、役に立つツールは目的の操作まで行けたか、また来てもらうものは別の日に来たかを見る

const rows = (users: number) => [
  { name: "play_time", detail: "0", visitors: users },
  { name: "play_time", detail: "15", visitors: 20 },
  { name: "play_time", detail: "60", visitors: 6 },
  { name: "results", detail: "2", visitors: 9 },
  { name: "result_kinds", detail: "3", visitors: 4 },
  { name: "revisit", detail: "", visitors: 3 },
];

test("遊びの深さの文: 人数と、遊び始めた人に対する割合を並べ、ねらいごとの見方を添える", () => {
  const d = playDepth(rows(30));
  const spread = playText({ kind: "tool", aim: "spread" }, d);
  assert.match(spread, /遊び始めた 30人 \/ 遊んだ時間: 15秒以上 20人（67%）・1分以上 6人（20%） \/ 結果を出した回数: 2回以上 9人（30%） \/ 出した結果の種類: 3種類以上 4人 \/ 別の日にまた来た 3人/);
  assert.match(spread, /見方: ねらいは「広がる」: 触ったあとも遊び続けたか/);
  assert.doesNotMatch(spread, /偶然の可能性/);
  // 役に立つツールは、短い時間で終わるのを悪いとみなさず、時間を伸ばす変更をさせない
  const useful = playText({ kind: "tool", aim: "useful" }, d);
  assert.match(useful, /見方: ねらいは「役に立つ」: 目的の操作まで行けたか.*短い時間で終わるのは.*悪くない.*増やすための変更はしない/);
  assert.match(playText({ kind: "tool", aim: "return" }, d), /見方: ねらいは「また来てもらう」: 別の日にまた来た人をいちばん重く見る/);
  assert.match(playText({ kind: "tool", aim: null }, d), /見方: ねらいが決まっていない案件: 遊んだ時間の長さだけで良し悪しを決めない/);
  // 遊び始めた人が少ないうちは、偶然の差だと書き添える
  assert.match(playText({ kind: "tool", aim: "spread" }, playDepth(rows(PLAY_FEW_USERS - 1))), new RegExp(`遊び始めた人が${PLAY_FEW_USERS}人未満のうちは、割合の差は偶然の可能性が高い`));
  // LP や、記録が届いていないツールには足さない
  assert.equal(playText({ kind: "lp", aim: null }, d), "");
  assert.equal(playText({ kind: "tool", aim: "spread" }, playDepth([])), "");
  assert.equal(playText({ kind: "tool", aim: "spread" }, null), "");
});

test("遊びの深さの文: AIの判断に渡す文（funnelText）に入る", () => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, lp_version) VALUES ('電卓', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 'useful', 1)").run().lastInsertRowid);
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source, lp_version) VALUES (?, ?, 40, 25, 'real', 1)").run(id, jstDay(new Date(Date.now() - 86_400_000)));
  const ins = db().prepare("INSERT INTO lp_funnel (project_id, version, name, detail, visitors) VALUES (?, 1, ?, ?, ?)");
  ins.run(id, "section_view", "tool", 38);
  for (const r of rows(25)) ins.run(id, r.name, r.detail, r.visitors);
  const p = db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
  const text = funnelText(p);
  assert.match(text, /ツールを操作した 25人（63%）/);
  assert.match(text, /遊びの深さ（今の版。割合は遊び始めた人に対して）: 遊び始めた 25人/);
  assert.match(text, /見方: ねらいは「役に立つ」/);
  db().prepare("DELETE FROM lp_funnel WHERE project_id = ?").run(id);
  db().prepare("DELETE FROM metrics WHERE project_id = ?").run(id);
});
