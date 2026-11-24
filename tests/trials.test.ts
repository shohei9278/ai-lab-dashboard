import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { addTrials, applyTrialResults, openTrials, settleDueTrials, trialStats, trialsText, type TrialRow } from "../src/lib/trials";
import { jstDay } from "../src/lib/sns";

// 試し: 朝会が決める「何を変えて、いつ・何の数字で判断するか」（運営者が決めた）

const live = (title: string, signups = 0) => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, published_at, public_slug) VALUES (?, 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', datetime('now'), ?)").run(title, `trial-${title}-${Math.random().toString(36).slice(2, 8)}`).lastInsertRowid);
  if (signups) db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, '2026-01-01', 30, ?, 'real')").run(id, signups);
  return id;
};
const row = (id: number) => db().prepare("SELECT * FROM plan_trials WHERE id = ?").get(id) as TrialRow;
const H = 3_600_000;

test("試し: 判定日時・見る数字・下限を決まりの範囲にそろえて入れ、同時に3件まで・1回に2件まで・同じ案件には重ねない", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("雪玉"), b = live("餃子"), c = live("編み図"), d = live("影");
  const set = new Set([a, b, c, d]);
  const now = Date.now();
  const n = addTrials(1, [
    { project_id: a, question: "動画のほうが使われるか", change: "静止画と短い動画で紹介する", metric: "conversions", judge_after_hours: 1000, min_visits: 1 },
    { project_id: a, question: "重ねる", change: "x" }, // 同じ案件
    { project_id: 9999, question: "公開していない", change: "x" },
    { project_id: b, question: "", change: "x" }, // 問いがない
    { project_id: c, question: "朝の投稿", change: "時間帯を朝にする" },
    { project_id: d, question: "3件目は今日は入れない", change: "x" },
  ], { live: set, model: "claude-opus-5-5", now });
  assert.equal(n, 2);
  const [ta, tc] = openTrials();
  assert.deepEqual([ta.project_id, ta.metric, ta.hours, ta.min_visits], [a, "conversions", 168, 5], "範囲の外は、範囲の端にそろえる");
  assert.deepEqual([tc.project_id, tc.metric, tc.hours, tc.min_visits], [c, "visits", 48, 20], "省いたものは決まりの値");
  // 次の日: 同時に3件までなので、あと1件だけ
  assert.equal(addTrials(2, [{ project_id: b, question: "q", change: "c" }, { project_id: d, question: "q", change: "c" }], { live: set, model: "gpt-5.6-sol" }), 1);
  assert.equal(openTrials().length, 3);
});

test("試し: 既存の案件の集客の実験（focus）は、登録・利用が出た案件だけ", () => {
  db().exec("DELETE FROM plan_trials");
  const used = live("使われた", 3), none = live("まだ0");
  addTrials(1, [{ project_id: used, question: "q", change: "c", focus: true }, { project_id: none, question: "q", change: "c", focus: true }], { live: new Set([used, none]), model: "claude-opus-5-5", focusOk: true });
  const t = openTrials();
  assert.deepEqual(t.map((x) => [x.project_id, x.focus]), [[used, 1], [none, 0]]);
  // ネックが reach / use で新しい案件を休む朝会でなければ、印があってもふつうの試し（PR #172 の ai-review の指摘）
  db().exec("DELETE FROM plan_trials");
  addTrials(1, [{ project_id: used, question: "q", change: "c", focus: true }], { live: new Set([used]), model: "claude-opus-5-5", focusOk: false });
  assert.equal(openTrials()[0].focus, 0);
});

test("試し: 判定日時の前は結論を出させず、下限に届かなければ1回だけ延ばし、それでも届かなければ判断できなかったとして閉じる", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("少ない");
  const start = Date.now();
  addTrials(1, [{ project_id: a, question: "切り口を変える", change: "使い方の例を見せる", judge_after_hours: 24, min_visits: 10 }], { live: new Set([a]), model: "claude-opus-5-5", now: start });
  const id = openTrials()[0].id;
  // 判定日時の前: 結論を出す対象にしない。材料でも「まだ結論を出さない」に並ぶ
  assert.deepEqual(settleDueTrials(start + 23 * H), []);
  assert.match(trialsText([], start + 23 * H), /判定日時が来ていない試し[^]*切り口を変える/);
  // 判定日時: 訪問が下限に届かないので、保留して延ばす
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 4, 0, 'real')").run(a, jstDay());
  assert.deepEqual(settleDueTrials(start + 25 * H), []);
  assert.equal(row(id).extended, 1);
  assert.equal(row(id).status, "open");
  // 延ばしても届かなければ、閉じる（結論は出さない）
  assert.deepEqual(settleDueTrials(start + 50 * H), []);
  assert.deepEqual([row(id).status, row(id).verdict], ["expired", null]);
  assert.equal(row(id).final_visits, 4);
});

test("試し: 数字がそろったら朝会のAIに結論を出させ、判定日時が来た試しの結論だけを入れる", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("足りた"), b = live("まだ");
  const start = Date.now();
  addTrials(1, [{ project_id: a, question: "動画で紹介", change: "短い動画", judge_after_hours: 24, min_visits: 5 }, { project_id: b, question: "まだの試し", change: "c", judge_after_hours: 72 }], { live: new Set([a, b]), model: "claude-opus-5-5", now: start });
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 12, 3, 'real')").run(a, jstDay());
  assert.equal(trialStats(openTrials()[0]).visits, 12);
  const due = settleDueTrials(start + 25 * H);
  assert.deepEqual(due.map((t) => t.project_id), [a]);
  assert.match(trialsText(due, start + 25 * H), /判定日時が来た試し[^]*動画で紹介[^]*訪問12・登録\/利用3/);
  const [ta, tb] = openTrials();
  // 判定日時が来ていない試しの結論・知らない番号・形の合わない結論は入れない
  assert.equal(applyTrialResults([{ id: tb.id, verdict: "win", result: "早すぎる" }, { id: 9999, verdict: "win", result: "x" }, { id: ta.id, verdict: "great", result: "x" }, { id: ta.id, verdict: "win", result: "動画の投稿から12訪問・3利用" }], due, "gpt-5.6-sol"), 1);
  assert.deepEqual([row(ta.id).status, row(ta.id).verdict, row(ta.id).decided_by], ["decided", "win", "gpt-5.6-sol"]);
  // 判定したときの数字を残す（終わったあとの流入を足さない。PR #172 の ai-review の指摘）
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 50, 5, 'real')").run(a, jstDay());
  assert.deepEqual([row(ta.id).final_visits, row(ta.id).final_conversions], [12, 3]);
  assert.equal(row(tb.id).status, "open");
});

test("朝会: 判定日時が来た試しを材料に渡して結論を入れさせ、新しい試しを入れる", async () => {
  const { createPlan } = await import("../src/lib/plan");
  db().exec("DELETE FROM plan_trials; DELETE FROM daily_plans");
  const a = live("朝会で決着", 2), b = live("朝会で始める", 1);
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 25, 2, 'real')").run(a, jstDay());
  addTrials(1, [{ project_id: a, question: "比べる", change: "c", judge_after_hours: 24, min_visits: 5 }], { live: new Set([a]), model: "claude-opus-5-5", now: Date.now() - 30 * H });
  const due = openTrials()[0];
  let planUser = "";
  const ask = async <T,>(o: { purpose: string; user: string; validate: (v: unknown) => v is T }): Promise<T> => {
    let v: unknown;
    if (o.purpose === "毎日の計画") {
      planUser = o.user;
      v = { bottleneck: "reach", evidence: "e", certainty: "low", review: "r", focus: "f", goals: [], pause_new: true, idea_note: "", tasks: [], research: null,
        trial_results: [{ id: due.id, verdict: "lose", result: "訪問25で利用2。前と変わらない" }],
        trials: [{ project_id: b, question: "動画で紹介すると使われるか", change: "静止画と短い動画を同じ時間帯に出す", metric: "conversions", judge_after_hours: 48, min_visits: 20, focus: true }] };
    } else if (o.purpose === "朝会（意見）") v = { opinion: "意見" };
    else if (o.purpose === "投稿の切り口の分類") v = { types: [] };
    else throw new Error(`想定していない呼び出し: ${o.purpose}`);
    assert.ok(o.validate(v), o.purpose);
    return v as T;
  };
  const keys = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
  const before = keys.map((k) => process.env[k]);
  keys.forEach((k) => (process.env[k] = "test-dummy"));
  try {
    await createPlan({ force: true, ask: ask as never, weather: async () => [] });
  } finally {
    keys.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
  }
  assert.match(planUser, /判定日時が来た試し[^]*比べる/);
  assert.deepEqual([row(due.id).status, row(due.id).verdict], ["decided", "lose"]);
  const started = openTrials();
  assert.deepEqual(started.map((t) => [t.project_id, t.metric, t.focus]), [[b, "conversions", 1]]);
});
