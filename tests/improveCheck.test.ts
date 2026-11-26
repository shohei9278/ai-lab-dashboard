import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, type ProjectRow } from "../src/lib/db";
import { CHECK_DAYS, CHECK_MIN_VISITS, checkJson, checkSummary, evaluateImproveChecks, improveChecksText, judgeCheck, parseCheck, pendingCheck, saveCheck } from "../src/lib/improveCheck";
import { jstDay } from "../src/lib/sns";

// ページの直しの答え合わせ（11/26 に運営者が決めた）: 直す前に予想・変える所・見る数字・いつ判断するかを決めて版に残し、
// 決めた訪問か期限に届いたら、直す前の版と決めた数字だけで比べる。待っている間は、同じ案件のページを自動では直さない

const DAY = 86_400_000;
const project = (kind: "lp" | "tool", aim: string | null = null) => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim, lp_version, public_version) VALUES ('案', 't', 'p', 's', 'h', 'r', 'live', 'claude', ?, ?, 2, 2)").run(kind, aim).lastInsertRowid);
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note) VALUES (?, 1, '{}', '最初の版'), (?, 2, '{}', '自動改善: 冒頭の説明を短くする')").run(id, id);
  return id;
};
const get = (id: number) => db().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow;
const visits = (id: number, version: number, v: number, signups: number) =>
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source, lp_version) VALUES (?, ?, ?, ?, 'real', ?)").run(id, jstDay(new Date(Date.now() - DAY)), v, signups, version);

test("答え合わせ: AIが書いた予想・変える所・見る数字・人数・期限を整え、書かなかった・選べない値は、ねらいに合わせた決まった値にする", () => {
  const ok = parseCheck({ why: "説明が足りず離脱している", part: "冒頭の説明", metric: "cta", min_visits: 40, days: 5 }, { kind: "lp", aim: null }, "冒頭を直す", 1);
  // 変えた所は、AIが書いた part ではなく、実際に直す指示そのもの（PR #208 の ai-review の指摘）
  assert.deepEqual([ok.why, ok.part, ok.metric, ok.minVisits, ok.days, ok.defaulted, ok.before], ["説明が足りず離脱している", "冒頭を直す", "cta", 40, 5, [], 1]);
  // ツールでは LP の数字は選べない。書かなかった項目は決まった値（変える所は、直す指示を使う）
  const fill = parseCheck({ metric: "cta", min_visits: 1000, days: 1 }, { kind: "tool", aim: "spread" }, "最初の画面のボタンを大きくする", 3);
  assert.equal(fill.metric, "play60");
  assert.equal(fill.part, "最初の画面のボタンを大きくする");
  assert.deepEqual([fill.minVisits, fill.days], [CHECK_MIN_VISITS.default, CHECK_DAYS.default]);
  assert.deepEqual(fill.defaulted, ["why", "metric", "min_visits", "days"]);
  assert.equal(parseCheck(null, { kind: "tool", aim: "useful" }, "x", 1).metric, "use");
  assert.equal(parseCheck(null, { kind: "tool", aim: "return" }, "x", 1).metric, "revisit");
});

test("答え合わせ: 決めた訪問に届くまでは待ち（その間は直さない）。届いたら直す前の版と決めた数字で比べ、結果と同じ期間の届け方を残す", () => {
  const id = project("lp");
  saveCheck(id, 2, parseCheck({ why: "ボタンが目に入らない", part: "登録ボタン", metric: "signup", min_visits: 30, days: 7 }, { kind: "lp", aim: null }, "ボタンを上に", 1));
  visits(id, 1, 40, 2); // 直す前: 5%
  visits(id, 2, 20, 4); // 直したあと: まだ20人
  assert.equal(pendingCheck(id)?.version, 2);
  assert.equal(evaluateImproveChecks(), 0);
  visits(id, 2, 15, 5); // 35人・9人 → 26%
  assert.equal(evaluateImproveChecks(), 1);
  const r = db().prepare("SELECT check_verdict, check_result FROM lp_versions WHERE project_id = ? AND version = 2").get(id) as { check_verdict: string; check_result: string };
  assert.equal(r.check_verdict, "better");
  assert.match(r.check_result, /見た数字: 事前登録した割合（訪問に対して）。直す前（第1版） 5%（2\/40人） → 直したあと（第2版） 26%（9\/35人）（\+21ポイント）/);
  assert.match(r.check_result, /流入元 直す前（第1版）: 記録なし \/ 直したあと（第2版）: 記録なし・直したあとの投稿: なし/);
  assert.equal(pendingCheck(id), null);
  assert.match(improveChecksText(id), /第2版: 予想「ボタンが目に入らない」→ 変えた所「ボタンを上に」→ 見る数字「事前登録した割合（訪問に対して）」→ 結果: 良くなった/);
  const ck = checkSummary(db().prepare("SELECT improve_check, check_verdict, check_result FROM lp_versions WHERE project_id = ? AND version = 2").get(id) as { improve_check: string; check_verdict: string; check_result: string });
  assert.equal(ck?.verdict, "better");
});

test("答え合わせ: 期限までに訪問が届かない・直す前の版が少ない・差が小さいときは、決めつけずに理由を残す", () => {
  const now = Date.now();
  // 期限が来ても訪問が届かなければ「判断できなかった」（期限が来たら、待ちも終わる）
  const a = project("lp");
  const ca = parseCheck({ why: "w", part: "p", metric: "signup", min_visits: 50, days: 3 }, { kind: "lp", aim: null }, "x", 1);
  visits(a, 1, 40, 2);
  visits(a, 2, 12, 1);
  assert.equal(judgeCheck(get(a), 2, ca, now), null);
  const late = judgeCheck(get(a), 2, ca, now + 3 * DAY + 60_000);
  assert.equal(late?.verdict, "unclear");
  assert.match(late!.result, /判断できなかった理由: 期限（3日）までに、新しい版の訪問が決めた50人に届かなかった（12人）/);
  saveCheck(a, 2, { ...ca, at: new Date(now - 4 * DAY).toISOString() });
  assert.equal(pendingCheck(a), null);
  // 直す前の版の訪問が少ない
  const b = project("lp");
  visits(b, 1, 5, 1);
  visits(b, 2, 30, 3);
  assert.match(judgeCheck(get(b), 2, parseCheck({ metric: "signup", min_visits: 30 }, { kind: "lp", aim: null }, "x", 1), now)!.result, /直す前の版の訪問が少ない（5人）/);
  // 差が5ポイントより小さいときは「差がはっきりしない」
  const c = project("lp");
  visits(c, 1, 40, 4);
  visits(c, 2, 40, 5);
  assert.equal(judgeCheck(get(c), 2, parseCheck({ metric: "signup", min_visits: 30 }, { kind: "lp", aim: null }, "x", 1), now)?.verdict, "flat");
  // 遊びの記録が届いていない数字は比べられない
  const d = project("tool", "spread");
  visits(d, 1, 40, 4);
  visits(d, 2, 40, 5);
  assert.match(judgeCheck(get(d), 2, parseCheck({ metric: "play60", min_visits: 30 }, { kind: "tool", aim: "spread" }, "x", 1), now)!.result, /この数字の記録が、直す前か直したあとの版に届いていない/);
});

test("答え合わせ: 答えが出る前に次の版に替わったら、比べられないと残す", () => {
  const id = project("lp");
  saveCheck(id, 2, parseCheck({ metric: "signup", min_visits: 30 }, { kind: "lp", aim: null }, "x", 1));
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note) VALUES (?, 3, '{}', '人が直した')").run(id);
  db().prepare("UPDATE projects SET lp_version = 3, public_version = 3 WHERE id = ?").run(id);
  evaluateImproveChecks();
  const r = db().prepare("SELECT check_verdict, check_result FROM lp_versions WHERE project_id = ? AND version = 2").get(id) as { check_verdict: string; check_result: string };
  assert.equal(r.check_verdict, "unclear");
  // 替わるまでの届け方も一緒に残す（PR #208 の ai-review の指摘）
  assert.match(r.check_result, /^判断できなかった理由: 答え合わせの前に、次の版に替わった\n流入元 直す前（第1版）: 記録なし \/ 直したあと（第2版）: 記録なし・直したあとの投稿: なし/);
});

test("答え合わせ: 待っている間は、自動の改善を止める理由になる（判断では人に回さず、今の版のまま集客を続ける）", async () => {
  const { improveBlocked } = await import("../src/lib/loop");
  const id = project("lp");
  db().prepare("UPDATE projects SET mode = 'auto', improve_count = 0 WHERE id = ?").run(id);
  // 答え合わせを決める前は、ほかに止める理由がない
  assert.equal(improveBlocked(get(id)), null);
  saveCheck(id, 2, parseCheck({ metric: "signup", min_visits: 30, days: 7 }, { kind: "lp", aim: null }, "x", 1));
  const gate = improveBlocked(get(id));
  assert.equal(gate?.wait, true);
  assert.match(gate!.reason, /前の直し（第2版）の答え合わせを待っているため（新しい版の訪問30人か、/);
});

test("答え合わせ: 期限を過ぎてから見たときは判断しない（期限のうちに届いたか確かめられない）。ちょうど5ポイントの差は差として扱う（PR #208 の ai-review の指摘）", () => {
  const now = Date.now();
  const a = project("lp");
  const c = parseCheck({ metric: "signup", min_visits: 30, days: 3 }, { kind: "lp", aim: null }, "x", 1, new Date(now - DAY).toISOString());
  visits(a, 1, 40, 4);
  visits(a, 2, 40, 6);
  // 期限の前に届いていれば判断する。4/40 → 6/40 はちょうど+5ポイントなので「良くなった」
  assert.equal(judgeCheck(get(a), 2, c, now)?.verdict, "better");
  // 期限を過ぎてから初めて見るときは、届いていても判断しない
  const late = judgeCheck(get(a), 2, c, now + 2 * DAY + 60_000);
  assert.equal(late?.verdict, "unclear");
  assert.match(late!.result, /のうちに、決めた30人に届いたかを確かめられない（期限のあとに届いた分が混ざる）/);
  // ちょうど-5ポイントは「悪くなった」
  const b = project("lp");
  visits(b, 1, 40, 6);
  visits(b, 2, 40, 4);
  assert.equal(judgeCheck(get(b), 2, parseCheck({ metric: "signup", min_visits: 30 }, { kind: "lp", aim: null }, "x", 1), now)?.verdict, "worse");
});

test("答え合わせ: 人数・日数は、整数で範囲の中のものだけを使い、変な形の値は決まった値にする（PR #208 の ai-review の指摘）", () => {
  const f = (raw: unknown) => parseCheck(raw, { kind: "lp", aim: null }, "x", 1);
  assert.deepEqual([f({ min_visits: "40", days: 5 }).minVisits, f({ min_visits: "40", days: 5 }).days], [40, 5]);
  const odd = f({ min_visits: 100.4, days: 2.9 });
  assert.deepEqual([odd.minVisits, odd.days], [CHECK_MIN_VISITS.default, CHECK_DAYS.default]);
  assert.deepEqual(odd.defaulted.filter((k) => k === "min_visits" || k === "days"), ["min_visits", "days"]);
  assert.equal(f({ min_visits: { valueOf: null, toString: null }, days: null }).minVisits, CHECK_MIN_VISITS.default);
});

test("答え合わせ: 次の版に替わったときは、替わった時刻までの投稿だけを残す（PR #208 の ai-review の指摘）", () => {
  const id = project("lp");
  saveCheck(id, 2, parseCheck({ metric: "signup", min_visits: 30 }, { kind: "lp", aim: null }, "x", 1, new Date(Date.now() - 2 * DAY).toISOString()));
  const post = db().prepare("INSERT INTO sns_posts (project_id, platform, text, status, author, post_url, posted_at, visits, conversions, code) VALUES (?, ?, 't', 'posted', 'ai', ?, datetime('now', ?), 0, 0, ?)");
  post.run(id, "threads", `https://www.threads.net/p/ic-a${id}`, "-1 days", `ica${id}`); // 替わる前
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note, created_at) VALUES (?, 3, '{}', '人が直した', datetime('now', '-12 hours'))").run(id);
  db().prepare("UPDATE projects SET lp_version = 3, public_version = 3 WHERE id = ?").run(id);
  post.run(id, "x", `https://x.com/u/status/ic-b${id}`, "-1 hours", `icb${id}`); // 替わったあと
  evaluateImproveChecks();
  const r = db().prepare("SELECT check_result FROM lp_versions WHERE project_id = ? AND version = 2").get(id) as { check_result: string };
  assert.match(r.check_result, /直したあとの投稿: threads 1件$/);
});

test("答え合わせ: 朝会の check は、要る項目だけを取り出して、項目ごとに長さを切ってから残す（JSON が壊れない）", () => {
  const raw = { why: "あ".repeat(5000), metric: "use", min_visits: 40, days: "5", part: "使わない", extra: "x".repeat(5000) };
  const j = checkJson(raw)!;
  const o = JSON.parse(j) as Record<string, unknown>;
  assert.deepEqual(Object.keys(o).sort(), ["days", "metric", "min_visits", "why"]);
  assert.equal((o.why as string).length, 200);
  assert.equal(o.days, 5);
  assert.equal(checkJson(null), null);
});

test("答え合わせ: 待っている間は、ほかの止める理由（改善の回数の上限など）より先に待ちとして止める（人の判断に回さない）", async () => {
  const { improveBlocked } = await import("../src/lib/loop");
  const id = project("lp");
  db().prepare("UPDATE projects SET mode = 'auto', improve_count = 99 WHERE id = ?").run(id);
  assert.equal(improveBlocked(get(id))?.wait, undefined); // 待ちがなければ、回数の上限で止まる
  saveCheck(id, 2, parseCheck({ metric: "signup", min_visits: 30, days: 7 }, { kind: "lp", aim: null }, "x", 1));
  assert.equal(improveBlocked(get(id))?.wait, true);
});
