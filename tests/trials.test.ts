import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { addTrials, applyTrialResults, openTrials, parseBranches, settleDueTrials, trialBranches, trialStats, trialsText, type TrialRow } from "../src/lib/trials";
import { jstDay } from "../src/lib/sns";

// 試し: 朝会が決める「何を変えて、いつ・何の数字で判断するか」（運営者が決めた）

const live = (title: string, signups = 0) => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, published_at, public_slug) VALUES (?, 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', datetime('now'), ?)").run(title, `trial-${title}-${Math.random().toString(36).slice(2, 8)}`).lastInsertRowid);
  if (signups) db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, '2026-01-01', 30, ?, 'real')").run(id, signups);
  return id;
};
// 朝会の予定（同じ案件の投稿か直しがない試しは入らない）
const promo = (...ids: number[]) => ids.map((project_id) => ({ kind: "promo", project_id }));
const row = (id: number) => db().prepare("SELECT * FROM plan_trials WHERE id = ?").get(id) as TrialRow;
const H = 3_600_000;
// 結果ごとの次の手（始める前に決める。ない試しは入らない）
const BR = [{ if: "登録・利用が3以上", then: "同じ見せ方を別の題材でも試す" }, { if: "登録・利用が0〜2", then: "最初の画面に使い方の例を出す" }];

test("試し: 判定日時・見る数字・下限を決まりの範囲にそろえて入れ、同時に3件まで・1回に2件まで・同じ案件には重ねない", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("雪玉"), b = live("餃子"), c = live("編み図"), d = live("影");
  const set = new Set([a, b, c, d]);
  const now = Date.now();
  const n = addTrials(1, [
    { project_id: a, question: "動画のほうが使われるか", change: "静止画と短い動画で紹介する", metric: "conversions", judge_after_hours: 1000, min_visits: 1, branches: BR },
    { project_id: a, question: "重ねる", change: "x", branches: BR }, // 同じ案件
    { project_id: 9999, question: "公開していない", change: "x", branches: BR },
    { project_id: b, question: "", change: "x", branches: BR }, // 問いがない
    { project_id: c, question: "朝の投稿", change: "時間帯を朝にする", branches: BR },
    { project_id: d, question: "3件目は今日は入れない", change: "x", branches: BR },
  ], { live: set, model: "claude-opus-5-5", tasks: promo(a, b, c, d), focusNeed: null, now });
  assert.equal(n, 2);
  const [ta, tc] = openTrials();
  assert.deepEqual([ta.project_id, ta.metric, ta.hours, ta.min_visits], [a, "conversions", 168, 5], "範囲の外は、範囲の端にそろえる");
  assert.deepEqual([tc.project_id, tc.metric, tc.hours, tc.min_visits], [c, "visits", 48, 20], "省いたものは決まりの値");
  // 次の日: 同時に3件までなので、あと1件だけ
  assert.equal(addTrials(2, [{ project_id: b, question: "q", change: "c", branches: BR }, { project_id: d, question: "q", change: "c", branches: BR }], { live: set, model: "gpt-6.2-sol", tasks: promo(b, d), focusNeed: null }), 1);
  assert.equal(openTrials().length, 3);
});

test("試し: その朝会の予定に、同じ案件の投稿か直しがない試しは入れない（何も変えない期間の数字で判定しない。PR #172 の ai-review の指摘）", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("予定あり"), b = live("予定なし");
  const n = addTrials(1, [{ project_id: a, question: "q", change: "c", branches: BR }, { project_id: b, question: "q", change: "c", branches: BR }], { live: new Set([a, b]), model: "claude-opus-5-5", tasks: [...promo(a), { kind: "plain", project_id: null }], focusNeed: null });
  assert.equal(n, 1);
  assert.deepEqual(openTrials().map((t) => t.project_id), [a]);
});

test("試し: 既存の案件の集客の実験（focus）は、登録・利用が出た案件だけ", () => {
  db().exec("DELETE FROM plan_trials");
  const used = live("使われた", 3), none = live("まだ0");
  addTrials(1, [{ project_id: used, question: "q", change: "c", focus: true, branches: BR }, { project_id: none, question: "q", change: "c", focus: true, branches: BR }], { live: new Set([used, none]), model: "claude-opus-5-5", tasks: promo(used, none), focusNeed: "promo" });
  const t = openTrials();
  assert.deepEqual(t.map((x) => [x.project_id, x.focus]), [[used, 1], [none, 0]]);
  // ネックが reach / use で新しい案件を休む朝会でなければ、印があってもふつうの試し（PR #172 の ai-review の指摘）
  db().exec("DELETE FROM plan_trials");
  addTrials(1, [{ project_id: used, question: "q", change: "c", focus: true, branches: BR }], { live: new Set([used]), model: "claude-opus-5-5", tasks: promo(used), focusNeed: null });
  assert.equal(openTrials()[0].focus, 0);
  // ネックが use（訪問はあるが使われない）なら、直し（improve）の予定があるときだけ
  db().exec("DELETE FROM plan_trials");
  addTrials(1, [{ project_id: used, question: "q", change: "c", focus: true, branches: BR }], { live: new Set([used]), model: "claude-opus-5-5", tasks: promo(used), focusNeed: "improve" });
  assert.equal(openTrials()[0].focus, 0);
});

test("試し: 判定日時の前は結論を出させず、下限に届かなければ1回だけ延ばし、それでも届かなければ判断できなかったとして閉じる", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("少ない");
  const start = Date.now();
  addTrials(1, [{ project_id: a, question: "切り口を変える", change: "使い方の例を見せる", judge_after_hours: 24, min_visits: 10, branches: BR }], { live: new Set([a]), model: "claude-opus-5-5", tasks: promo(a), focusNeed: null, now: start });
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
  // 朝会が止まっていて、延ばした先ももう過ぎているときは、その場で閉じる（PR #172 の ai-review の指摘）
  db().exec("DELETE FROM plan_trials");
  addTrials(1, [{ project_id: a, question: "遅れた", change: "c", judge_after_hours: 24, min_visits: 10, branches: BR }], { live: new Set([a]), model: "claude-opus-5-5", tasks: promo(a), focusNeed: null, now: start });
  const late = openTrials()[0].id;
  assert.deepEqual(settleDueTrials(start + 60 * H), []);
  assert.deepEqual([row(late).status, row(late).extended], ["expired", 0]);
});

test("試し: 数字がそろったら朝会のAIに結論を出させ、判定日時が来た試しの結論だけを入れる", () => {
  db().exec("DELETE FROM plan_trials");
  const a = live("足りた"), b = live("まだ");
  const start = Date.now();
  addTrials(1, [{ project_id: a, question: "動画で紹介", change: "短い動画", judge_after_hours: 24, min_visits: 5, branches: BR }, { project_id: b, question: "まだの試し", change: "c", judge_after_hours: 72, branches: BR }], { live: new Set([a, b]), model: "claude-opus-5-5", tasks: promo(a, b), focusNeed: null, now: start });
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 12, 3, 'real')").run(a, jstDay());
  assert.equal(trialStats(openTrials()[0]).visits, 12);
  const due = settleDueTrials(start + 25 * H);
  assert.deepEqual(due.map((t) => t.project_id), [a]);
  assert.match(trialsText(due, start + 25 * H), /判定日時が来た試し[^]*動画で紹介[^]*訪問12・登録\/利用3/);
  const [ta, tb] = openTrials();
  // 判定日時が来ていない試しの結論・知らない番号・形の合わない結論は入れない
  assert.equal(applyTrialResults([{ id: tb.id, verdict: "win", result: "早すぎる" }, { id: 9999, verdict: "win", result: "x" }, { id: ta.id, verdict: "great", result: "x" }, { id: ta.id, verdict: "win", result: "動画の投稿から12訪問・3利用" }], due, "gpt-6.2-sol"), 1);
  assert.deepEqual([row(ta.id).status, row(ta.id).verdict, row(ta.id).decided_by], ["decided", "win", "gpt-6.2-sol"]);
  // 判定したときの数字を残す（終わったあとの流入を足さない。PR #172 の ai-review の指摘）
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 50, 5, 'real')").run(a, jstDay());
  assert.deepEqual([row(ta.id).final_visits, row(ta.id).final_conversions], [12, 3]);
  assert.equal(row(tb.id).status, "open");
});

test("朝会: 判定日時が来た試しを材料に渡して結論を入れさせ、新しい試しを入れる", async () => {
  const { createPlan } = await import("../src/lib/plan");
  db().exec("DELETE FROM plan_trials; DELETE FROM daily_plans");
  const a = live("朝会で決着", 2);
  // 直し（improve）を予定に入れられる案件（自動で任せる事前登録のページ）
  db().prepare("UPDATE projects SET kind = 'lp', mode = 'auto' WHERE id = ?").run(a);
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 25, 2, 'real')").run(a, jstDay());
  addTrials(1, [{ project_id: a, question: "比べる", change: "c", judge_after_hours: 24, min_visits: 5, branches: BR }], { live: new Set([a]), model: "claude-opus-5-5", tasks: promo(a), focusNeed: null, now: Date.now() - 30 * H });
  const due = openTrials()[0];
  let planUser = "";
  const ask = async <T,>(o: { purpose: string; user: string; validate: (v: unknown) => v is T }): Promise<T> => {
    let v: unknown;
    if (o.purpose === "毎日の計画") {
      planUser = o.user;
      v = { bottleneck: "use", evidence: "e", certainty: "low", review: "r", focus: "f", goals: [], pause_new: true, idea_note: "", research: null,
        // 判定した試しは、数字（訪問25・利用2）に合う条件2を選び、その次の手を同じ案件の直しとして今日の予定に入れる
        tasks: [{ time: "23:59", kind: "improve", project_id: a, angle: "最初の画面に使い方の例を出す", reason: "先に決めた条件2（登録・利用が0〜2）に当たった" }],
        trial_results: [{ id: due.id, verdict: "lose", branch: 2, result: "訪問25で利用2。前と変わらない" }],
        trials: [{ project_id: a, question: "使い方の例を出すと使われるか", change: "最初の画面に使い方の例を出す", metric: "conversions", judge_after_hours: 48, min_visits: 20, focus: true, branches: BR }] };
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
  assert.deepEqual([row(due.id).status, row(due.id).verdict, row(due.id).matched_branch], ["decided", "lose", 2]);
  assert.match(planUser, /先に決めた次の手: 1\. 登録・利用が3以上 → 同じ見せ方を別の題材でも試す \/ 2\. 登録・利用が0〜2 → 最初の画面に使い方の例を出す/);
  // 当たった条件の次の手が、今日の予定に残る（AIの答えを決めて渡したときの、保存の流れの確かめ。実際のAIが正しい条件を選ぶかは、ここでは確かめない）
  const plan = db().prepare("SELECT id FROM daily_plans ORDER BY id DESC LIMIT 1").get() as { id: number };
  assert.deepEqual(db().prepare("SELECT kind, project_id, angle FROM plan_tasks WHERE plan_id = ?").all(plan.id), [{ kind: "improve", project_id: a, angle: "最初の画面に使い方の例を出す" }]);
  const started = openTrials();
  // 新しく始めた試しも、選んだ次の手と同じ変更を記録する
  assert.deepEqual(started.map((t) => [t.project_id, t.metric, t.focus, t.change]), [[a, "conversions", 1, "最初の画面に使い方の例を出す"]]);
});

test("試し: 結果ごとの次の手を始める前に決め（ない試しは入れない）、判定ではどの条件に当たったかを残す", () => {
  db().exec("DELETE FROM plan_trials");
  // 次の手の読み方: 2〜3個で、どれも条件と次の手の両方があるときだけ受け取る
  assert.equal(parseBranches(undefined), null);
  assert.equal(parseBranches([{ if: "a", then: "b" }]), null);
  // そろった2件に、欠けたもの・形の違うものが1件でも混ざれば、試し全体を入れない（黙って落とさない。PR #190 の ai-review の指摘）
  assert.equal(parseBranches([{ if: "a", then: "b" }, { if: "c", then: "d" }, { if: "e", then: "" }]), null);
  assert.equal(parseBranches([{ if: "a", then: "b" }, { if: "c", then: "d" }, "x"]), null);
  // 4件以上も、黙って3件に切らずに入れない
  assert.equal(parseBranches([{ if: "a", then: "b" }, { if: "c", then: "d" }, { if: "e", then: "f" }, { if: "g", then: "h" }]), null);
  assert.deepEqual(parseBranches([{ if: " a ", then: "b" }, { if: "c", then: " d " }, { if: "e", then: "f" }]), [{ if: "a", then: "b" }, { if: "c", then: "d" }, { if: "e", then: "f" }]);
  const a = live("次の手なし"), b = live("次の手あり"), c = live("当たらない"), d = live("番号の外");
  const start = Date.now();
  const n = addTrials(1, [
    { project_id: a, question: "次の手を決めていない", change: "c", judge_after_hours: 24, min_visits: 5 },
    { project_id: b, question: "次の手を決めた", change: "c", judge_after_hours: 24, min_visits: 5, branches: BR },
  ], { live: new Set([a, b]), model: "claude-opus-5-5", tasks: promo(a, b), focusNeed: null, now: start });
  assert.equal(n, 1);
  const tb = openTrials()[0];
  assert.deepEqual([tb.project_id, trialBranches(tb)], [b, BR]);
  addTrials(2, [{ project_id: c, question: "q", change: "c", judge_after_hours: 24, min_visits: 5, branches: BR }, { project_id: d, question: "q", change: "c", judge_after_hours: 24, min_visits: 5, branches: BR }], { live: new Set([c, d]), model: "claude-opus-5-5", tasks: promo(c, d), focusNeed: null, now: start });
  for (const p of [b, c, d]) db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 10, 1, 'real')").run(p, jstDay());
  const due = settleDueTrials(start + 25 * H);
  assert.equal(due.length, 3);
  // 判定の材料に、先に決めた次の手を出す
  assert.match(trialsText(due, start + 25 * H), /先に決めた次の手: 1\. 登録・利用が3以上 → 同じ見せ方を別の題材でも試す/);
  const id = (p: number) => due.find((t) => t.project_id === p)!.id;
  assert.equal(applyTrialResults([
    { id: id(b), verdict: "lose", branch: 2, result: "訪問10で利用1" },
    { id: id(c), verdict: "unclear", branch: 0, result: "どの条件にも当たらない" },
    { id: id(d), verdict: "lose", branch: 5, result: "番号の外" },
  ], due, "gemini-3.1-pro-preview"), 3);
  assert.deepEqual([row(id(b)).matched_branch, row(id(c)).matched_branch, row(id(d)).matched_branch], [2, 0, null]);
  // 終わった試しの材料にも、当たった条件と決めていた次の手を出す
  assert.match(trialsText([], start + 26 * H), /当たった条件: 登録・利用が0〜2 → 決めていた次の手: 最初の画面に使い方の例を出す/);
  assert.match(trialsText([], start + 26 * H), /先に決めた条件のどれにも当たらなかった/);
  // 数でない答え（null・空の文字・true・数の文字）は、選んでいないとして空のまま（明らかな 0 とは分ける。PR #190 の ai-review の指摘）
  const more = [live("null"), live("空"), live("true")];
  // 1回の朝会で始めるのは2件までなので、2回に分けて入れる
  for (const [plan, ps] of [[3, more.slice(0, 2)], [4, more.slice(2)]] as const) {
    addTrials(plan, ps.map((p) => ({ project_id: p, question: "q", change: "c", judge_after_hours: 24, min_visits: 5, branches: BR })), { live: new Set(more), model: "claude-opus-5-5", tasks: promo(...more), focusNeed: null, now: start });
  }
  for (const p of more) db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 10, 0, 'real')").run(p, jstDay());
  const due2 = settleDueTrials(start + 25 * H);
  const id2 = (p: number) => due2.find((t) => t.project_id === p)!.id;
  assert.equal(applyTrialResults([
    { id: id2(more[0]), verdict: "unclear", branch: null, result: "r" },
    { id: id2(more[1]), verdict: "unclear", branch: "", result: "r" },
    { id: id2(more[2]), verdict: "unclear", branch: true, result: "r" },
  ], due2, "gemini-3.1-pro-preview"), 3);
  assert.deepEqual(more.map((p) => row(id2(p)).matched_branch), [null, null, null]);
});
