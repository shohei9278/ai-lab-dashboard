import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings, type ProjectRow } from "../src/lib/db";
import { aimBasis, aimJudgeLine, capacityBasis, judgeBasis, parseJudgeAdjust } from "../src/lib/judgeBasis";
import { SETTING_TITLE, addSettingProposals, settingsReviewText } from "../src/lib/settingsReview";
import { EXACT_TITLE_PREFIX } from "../src/lib/voices";

// 判断に入る基準をねらいごとにする（11/26 に運営者が決めた）。案件ごとの調整は公開の前だけ。見直しはAIが提案し、運営者が決める

const keep = getSettings();
const reset = () => saveSettings({
  judgeMinVisits: 100, judgeAfterDays: 7,
  judgeVisitsSpread: 0, judgeDaysSpread: 0, judgeVisitsUseful: 0, judgeDaysUseful: 0, judgeVisitsReturn: 0, judgeDaysReturn: 0, judgeVisitsDemand: 0, judgeDaysDemand: 0,
});
const restore = () => saveSettings({
  judgeMinVisits: keep.judgeMinVisits, judgeAfterDays: keep.judgeAfterDays,
  judgeVisitsSpread: keep.judgeVisitsSpread, judgeDaysSpread: keep.judgeDaysSpread, judgeVisitsUseful: keep.judgeVisitsUseful, judgeDaysUseful: keep.judgeDaysUseful,
  judgeVisitsReturn: keep.judgeVisitsReturn, judgeDaysReturn: keep.judgeDaysReturn, judgeVisitsDemand: keep.judgeVisitsDemand, judgeDaysDemand: keep.judgeDaysDemand,
});
const row = (o: Partial<ProjectRow>) => ({ aim: null, kind: "tool", judge_visits: null, judge_days: null, judge_reason: null, ...o }) as Pick<ProjectRow, "aim" | "kind" | "judge_visits" | "judge_days" | "judge_reason">;

test("判断の基準: ねらいごとの値がなければ一括の値。ねらいのない古い案件は、ツールなら「役に立つ」、LP なら「需要を確かめる」の基準", () => {
  reset();
  saveSettings({ judgeVisitsReturn: 60, judgeDaysReturn: 14, judgeVisitsDemand: 150 });
  const s = getSettings();
  assert.deepEqual(aimBasis("spread", s), { visits: 100, days: 7, own: false });
  assert.deepEqual(aimBasis("return", s), { visits: 60, days: 14, own: true });
  assert.deepEqual(aimBasis("demand", s), { visits: 150, days: 7, own: true });
  assert.equal(judgeBasis(row({ aim: "return" }), s).days, 14);
  assert.equal(judgeBasis(row({ aim: null, kind: "lp" }), s).visits, 150);
  assert.equal(judgeBasis(row({ aim: null, kind: "tool" }), s).visits, 100);
  assert.match(aimJudgeLine(s), /広がる 訪問100人か7日 \/ 役に立つ 訪問100人か7日 \/ また来てもらう 訪問60人か14日 \/ 需要を確かめる 訪問150人か7日/);
  // 案件ごとに調整した値があれば、それを使う
  const adj = judgeBasis(row({ aim: "return", judge_visits: 40, judge_days: 21, judge_reason: "週に1回しか使わない" }), s);
  assert.deepEqual([adj.visits, adj.days, adj.adjusted, adj.reason], [40, 21, true, "週に1回しか使わない"]);
  restore();
});

test("判断の基準: 案件ごとの調整は、理由があるときだけ、ねらいの基準の半分〜1.5倍に収める", () => {
  const base = { visits: 100, days: 10 };
  assert.deepEqual(parseJudgeAdjust({ visits: 300, days: 2, why: "季節もので数日しか需要がない" }, base), { visits: 150, days: 5, reason: "季節もので数日しか需要がない" });
  assert.deepEqual(parseJudgeAdjust({ visits: 80, why: "対象が狭い" }, base), { visits: 80, days: 10, reason: "対象が狭い" });
  assert.equal(parseJudgeAdjust({ visits: 80 }, base), null); // 理由がなければ調整しない
  assert.equal(parseJudgeAdjust({ visits: 100, days: 10, why: "同じ" }, base), null); // 基準と同じなら調整しない
  assert.equal(parseJudgeAdjust(null, base), null);
});

test("判断の基準: 今の流入で育てられる案件の数は、「広がる」を除いて、ねらいの配分で重み付けした基準で見る", () => {
  reset();
  saveSettings({ judgeVisitsUseful: 60, judgeDaysUseful: 10, aimSpread: 4, aimUseful: 1, aimReturn: 1, aimDemand: 0 });
  assert.deepEqual(capacityBasis(getSettings()), { visits: 80, days: 9 });
  saveSettings({ aimSpread: keep.aimSpread, aimUseful: keep.aimUseful, aimReturn: keep.aimReturn, aimDemand: keep.aimDemand });
  restore();
});

test("設定の見直し: 定例会議の案は、物差しの項目だけ・範囲の内・今と違う値・週2件まで・同じ項目は14日に1回、運営者あてに提案箱へ入れる", () => {
  reset();
  db().exec("DELETE FROM plan_requests");
  const s = getSettings();
  assert.match(settingsReviewText(s), /judgeVisitsReturn（「また来てもらう」の判断に入る訪問数）: 0（0 は一括の値を使う）/);
  assert.match(settingsReviewText(s), /- また来てもらう: 基準 訪問100人か7日（一括の値）/);
  const n = addSettingProposals([
    { raw: { key: "monthlyBudgetJpy", value: 99999, why: "予算を増やしたい" }, proposer: "gpt" }, // お金の項目は受け付けない
    { raw: { key: "judgeDaysReturn", value: 99, why: "範囲の外" }, proposer: "gpt" },
    { raw: { key: "judgeMinVisits", value: 100, why: "今と同じ" }, proposer: "gpt" },
    { raw: { key: "judgeDaysReturn", value: 14, why: "再訪の判定に7日は短い。直近60日のまた来てもらう3件は、7日で再訪0人" }, proposer: "claude" },
    { raw: { key: "targetUseRate", value: 0.2, why: "利用率の中央値が12%で、30%に届いた案件がない" }, proposer: "gemini" },
    { raw: { key: "maxAutoImprove", value: 3, why: "3件目" }, proposer: "gpt" },
  ], null, s);
  assert.equal(n, 2);
  const rows = db().prepare("SELECT title, how, target FROM plan_requests ORDER BY id").all() as { title: string; how: string; target: string }[];
  assert.deepEqual(rows.map((r) => r.target), ["human", "human"]);
  assert.equal(rows[0].title, "設定の見直し: 「また来てもらう」の訪問が少なくても判断する日数");
  assert.match(rows[0].how, /judgeDaysReturn）を 0 から 14 にする。変えるかは運営者が決める/);
  assert.match(rows[1].how, /利用率の目標」（targetUseRate）を 30% から 20% にする/);
  // 同じ項目は14日のあいだ出さない
  assert.equal(addSettingProposals([{ raw: { key: "judgeDaysReturn", value: 21, why: "もう一度" }, proposer: "gpt" }], null, s), 0);
  db().exec("DELETE FROM plan_requests");
  restore();
});

test("設定の見直し: 項目だけが違う設定の見直しどうしは、似た提案としてまとめない（ほかの提案ともまとめない）", async () => {
  const { mergeSimilarOpen } = await import("../src/lib/voices");
  reset();
  db().exec("DELETE FROM plan_requests");
  const s = getSettings();
  addSettingProposals([
    { raw: { key: "judgeDaysReturn", value: 14, why: "再訪の判定に7日は短い" }, proposer: "claude" },
    { raw: { key: "judgeDaysUseful", value: 10, why: "使われるかの判定に7日は短い" }, proposer: "gpt" },
  ], null, s);
  mergeSimilarOpen(true);
  assert.equal(SETTING_TITLE, EXACT_TITLE_PREFIX);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM plan_requests WHERE status = 'open'").get() as { n: number }).n, 2);
  db().exec("DELETE FROM plan_requests");
  restore();
});
