import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings, type ProjectRow } from "../src/lib/db";
import { aimBasis, aimJudgeLine, capacityBasis, judgeBasis, parseJudgeAdjust } from "../src/lib/judgeBasis";
import { SETTING_TITLE, addSettingProposals, medianOf, settingsReviewText } from "../src/lib/settingsReview";
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
  assert.match(aimJudgeLine(s), /広がる 公開から3日で遊んだ人20人かシェア3件（当たったあとは 訪問100人か7日） \/ 役に立つ 訪問100人か7日 \/ また来てもらう 訪問60人か14日 \/ 需要を確かめる 訪問150人か7日/);
  // 案件ごとに調整した値があれば、それを使う
  const adj = judgeBasis(row({ aim: "return", judge_visits: 40, judge_days: 21, judge_reason: "週に1回しか使わない" }), s);
  assert.deepEqual([adj.visits, adj.days, adj.adjusted, adj.reason], [40, 21, true, "週に1回しか使わない"]);
  // あとでねらいの基準と同じ値になっても、案件の値が残っていれば「調整した」と分かる（PR #209 の ai-review の指摘）
  assert.equal(judgeBasis(row({ aim: "return", judge_days: 14, judge_reason: "r" }), s).adjusted, true);
  restore();
});

test("判断の基準: 案件ごとの調整は、理由があるときだけ、ねらいの基準の半分〜1.5倍に収める", () => {
  const base = { visits: 100, days: 10 };
  assert.deepEqual(parseJudgeAdjust({ visits: 300, days: 2, why: "季節もので数日しか需要がない" }, base), { visits: 150, days: 5, reason: "季節もので数日しか需要がない" });
  // 片方だけ調整したら、もう片方は残さない（ねらいの基準に付いていく。PR #209 の ai-review の指摘）
  assert.deepEqual(parseJudgeAdjust({ visits: 80, why: "対象が狭い" }, base), { visits: 80, days: null, reason: "対象が狭い" });
  // 本物の数でない値は、その項目の調整なし
  assert.equal(parseJudgeAdjust({ visits: true, days: "20", why: "x" }, base), null);
  assert.equal(parseJudgeAdjust({ visits: 80 }, base), null); // 理由がなければ調整しない
  assert.equal(parseJudgeAdjust({ visits: 100, days: 10, why: "同じ" }, base), null); // 基準と同じなら調整しない
  assert.equal(parseJudgeAdjust(null, base), null);
  // 幅は、下限を切り上げ・上限を切り捨て（7日の1.5倍は10日まで。1日なら1日のまま。PR #209 の ai-review の指摘）
  assert.equal(parseJudgeAdjust({ days: 30, why: "長い" }, { visits: 100, days: 7 })?.days, 10);
  assert.equal(parseJudgeAdjust({ days: 3, why: "長い" }, { visits: 100, days: 1 }), null);
  assert.equal(parseJudgeAdjust({ visits: 1, why: "短い" }, { visits: 3, days: 7 })?.visits, 2);
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
  // 週2件は、同じ週に会議を開き直しても超えない（直近7日に入った分も数える。PR #209 の ai-review の指摘）
  assert.equal(addSettingProposals([{ raw: { key: "maxAutoImprove", value: 3, why: "開き直した会議" }, proposer: "gpt" }], null, s), 0);
  db().exec("DELETE FROM plan_requests");
  // 登録していない項目名（継承した名前）・本物の数でない値・画面で保てない刻みは受け付けない
  assert.equal(addSettingProposals([
    { raw: { key: "constructor", value: 1, why: "x" }, proposer: "gpt" },
    { raw: { key: "judgeVisitsReturn", value: null, why: "x" }, proposer: "gpt" },
    { raw: { key: "judgeVisitsReturn", value: "60", why: "x" }, proposer: "gpt" },
    { raw: { key: "targetUseRate", value: 0.005, why: "x" }, proposer: "gpt" },
    { raw: { key: "judgeDaysReturn", value: 10.5, why: "x" }, proposer: "gpt" },
  ], null, s), 0);
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

test("設定の見直し: 訪問の中央値は、全部の訪問を足した値から出し、件数が偶数なら真ん中2つの平均（PR #209 の ai-review の指摘）", () => {
  assert.equal(medianOf([500, 20, 80]), 80);
  assert.equal(medianOf([500, 20, 80, 120]), 100);
  assert.equal(medianOf([]), 0);
});

test("設定の見直しの材料: 届いたかは、ねらいの基準で、版ごとの訪問で見る。届くまでの日数は日本時間の日付どうしで比べる（PR #209 の ai-review の指摘）", () => {
  reset();
  const s = getSettings();
  db().exec("DELETE FROM metrics");
  // 公開日は今日から10日前（日本時間18時。テストを走らせる日に関係なく、直近60日に入るように。PR #209 の ai-review の指摘）
  const jst = (t: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(t));
  const pubDay = jst(Date.now() - 10 * 86_400_000);
  const pub = `${pubDay} 09:00:00`;
  const after = (n: number) => jst(Date.parse(`${pubDay}T00:00:00Z`) + n * 86_400_000);
  const add = (title: string, judgeVisits: number | null) => Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, judge_visits, published_at) VALUES (?, 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 'useful', ?, ?)").run(title, judgeVisits, pub).lastInsertRowid);
  const m = db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source, lp_version) VALUES (?, ?, ?, 0, 'real', ?)");
  // 版をまたぐと110人だが、どの版も100人に届いていない → 届いていない
  const a = add("版をまたぐ", null);
  m.run(a, after(1), 70, 1);
  m.run(a, after(2), 40, 2);
  // 案件の基準は60人に調整しているが、ねらいの基準（100人）では届いていない → 届いていない（調整した案件として数える）
  const b = add("調整した", 60);
  m.run(b, after(1), 70, 1);
  // 公開（日本時間 18時）の翌日に届いた → 1日
  const c = add("翌日に届いた", null);
  m.run(c, after(1), 120, 1);
  const text = settingsReviewText(s);
  assert.match(text, /- 役に立つ: 基準 訪問100人か7日（一括の値）・直近60日に公開した3件のうち、1つの版の訪問で基準に届いたのは1件（届くまで平均1日）・訪問の中央値110人・撤退0件・うち1件は案件ごとに基準を調整している/);
  db().exec("DELETE FROM metrics");
  db().prepare("DELETE FROM projects WHERE id IN (?, ?, ?)").run(a, b, c);
  restore();
});

test("判断の基準の文: 「広がる」は、実際の判定と同じく、決めた日数の遊んだ人とシェアで書き、設定を変えると文も変わる（提案箱 #107）", async () => {
  const { judgedByVisits } = await import("../src/lib/judgeBasis");
  reset();
  const k = getSettings();
  saveSettings({ spreadJudgeDays: 5, spreadHitPlays: 30, spreadHitShares: 4, spreadMinVisits: 25 });
  assert.match(aimJudgeLine(getSettings()), /^広がる 公開から5日で遊んだ人30人かシェア4件（当たったあとは 訪問100人か7日） \/ 役に立つ 訪問100人か7日/);
  assert.match(settingsReviewText(getSettings()), /- 広がる: 当たりの判定 公開から5日で遊んだ人30人かシェア4件（訪問25人に届かなければ1回延ばす。延ばしたのは\d+件。提案箱 #106）・当たったのは\d+件（外れ\d+件）・当たったあとの基準 訪問100人か7日/);
  saveSettings({ spreadJudgeDays: k.spreadJudgeDays, spreadHitPlays: k.spreadHitPlays, spreadHitShares: k.spreadHitShares, spreadMinVisits: k.spreadMinVisits });
  // 育てる段階の前の「広がる」は、訪問の基準では数えない
  assert.equal(judgedByVisits({ aim: "spread", growth_phase: 0 }), false);
  assert.equal(judgedByVisits({ aim: "spread", growth_phase: 1 }), true);
  assert.equal(judgedByVisits({ aim: "useful", growth_phase: 0 }), true);
  restore();
});

test("設定の見直しの材料: 「広がる」の訪問の基準に届いた件数は、育てる段階に入った案件だけで数える（外れた案件・判定前の案件は入れない。PR #210 の ai-review の指摘）", () => {
  reset();
  const s = getSettings();
  db().exec("DELETE FROM metrics");
  const jst = (t: number) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date(t));
  const pubDay = jst(Date.now() - 10 * 86_400_000);
  const add = (title: string, hit: number | null, growth: number) => Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, spread_hit, growth_phase, published_at) VALUES (?, 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 'spread', ?, ?, ?)").run(title, hit, growth, `${pubDay} 09:00:00`).lastInsertRowid);
  const m = db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source, lp_version) VALUES (?, ?, ?, 0, 'real', 1)");
  const miss = add("外れたが訪問は多い", 0, 0);
  m.run(miss, jst(Date.parse(`${pubDay}T00:00:00Z`) + 86_400_000), 150);
  const grown = add("当たって育てる段階", 1, 1);
  m.run(grown, jst(Date.parse(`${pubDay}T00:00:00Z`) + 2 * 86_400_000), 120);
  const line = settingsReviewText(s).split("\n").find((l) => l.startsWith("- 広がる:"))!;
  assert.match(line, /当たったのは1件（外れ1件）/);
  assert.match(line, /直近60日に公開した2件（訪問の基準で判断するのは、育てる段階に入った1件）のうち、1つの版の訪問で基準に届いたのは1件（届くまで平均2日）・訪問の中央値120人/);
  db().exec("DELETE FROM metrics");
  db().prepare("DELETE FROM projects WHERE id IN (?, ?)").run(miss, grown);
  restore();
});
