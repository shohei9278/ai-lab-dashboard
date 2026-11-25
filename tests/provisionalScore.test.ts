import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { scoreProvisional, unscoredProposals } from "../src/lib/provisionalScore";
import { nextAutoAsk } from "../src/lib/autoAsk";
import { scoringExisting } from "../src/lib/weekly";
import { REVIEW_SCENE } from "../src/lib/codeReview";

// 朝会の仮の採点（運営者が決めた）: 点のない提案に朝会のあとで仮の点を付け、7点以上なら月曜を待たずに自動で頼む

const KEYS = ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY"];
async function withKeys<T>(fn: () => Promise<T>): Promise<T> {
  const before = KEYS.map((k) => process.env[k]);
  KEYS.forEach((k) => (process.env[k] = "test-dummy"));
  try {
    return await fn();
  } finally {
    KEYS.forEach((k, i) => (before[i] === undefined ? delete process.env[k] : (process.env[k] = before[i])));
  }
}
const add = (title: string, o: { source?: string; scene?: string; proposer?: string; score?: number | null; ago?: string } = {}) =>
  Number(db().prepare("INSERT INTO plan_requests (title, how, why, target, source, scene, proposer, score, created_at) VALUES (?, 'h', 'w', 'system', ?, ?, ?, ?, datetime('now', ?))")
    .run(title, o.source ?? "scene", o.scene ?? "ツールのチェック", o.proposer ?? "gpt-6.2-sol", o.score ?? null, o.ago ?? "-1 hours").lastInsertRowid);
const row = (id: number) => db().prepare("SELECT score, score_provisional, status FROM plan_requests WHERE id = ?").get(id) as { score: number | null; score_provisional: number; status: string };
// 題に「重要」があれば8点、「地味」なら4点、ほかは6点を付ける採点者（何社でも同じ）
const fakeAsk = (calls: string[]) => (async (o: { purpose: string; user: string; validate: (v: unknown) => boolean }) => {
  calls.push(o.purpose);
  const scores = [...o.user.matchAll(/【(P\d+)】（[^）]*）([^:]+):/g)].map(([, id, title]) => ({ id, score: title.includes("重要") ? 8 : title.includes("地味") ? 4 : 6 }));
  const v = { scores };
  assert.ok(o.validate(v));
  return v;
}) as never;

test("仮の採点: 点のない返事待ちの提案だけに、3社が作者を伏せて仮の点を付ける。仮の点では見送りにしない", async () => {
  db().exec("DELETE FROM plan_requests");
  const important = add("重要な直し");
  const dull = add("地味な直し");
  const human = add("運営者の提案", { source: "human", scene: "" });
  const guard = add("守りの直し", { source: "review", scene: REVIEW_SCENE });
  const already = add("採点済み", { score: 7.2 });
  assert.deepEqual(unscoredProposals().map((r) => r.id), [important, dull]);
  const calls: string[] = [];
  const r = await withKeys(() => scoreProvisional({ material: "材料", ask: fakeAsk(calls) }));
  assert.deepEqual(r, { scored: 2, high: 1 });
  assert.ok(calls.length >= 2 && calls.every((c) => c === "朝会（提案の仮の採点）"));
  assert.deepEqual(row(important), { score: 8, score_provisional: 1, status: "open" });
  assert.deepEqual(row(dull), { score: 4, score_provisional: 1, status: "open" }, "仮の点が5点未満でも見送りにしない");
  assert.equal(row(human).score, null);
  assert.equal(row(guard).score, null);
  assert.deepEqual(row(already), { score: 7.2, score_provisional: 0, status: "open" });
  // 付けたあとは、もう採点しない（AIを呼ばない）
  const again: string[] = [];
  assert.deepEqual(await withKeys(() => scoreProvisional({ material: "材料", ask: fakeAsk(again) })), { scored: 0, high: 0 });
  assert.equal(again.length, 0);
});

test("仮の採点: 採点が取れなかった提案は点のまま残し、次の朝会でまた採点する", async () => {
  db().exec("DELETE FROM plan_requests");
  const id = add("重要だが採点に失敗");
  const fail = (async () => { throw new Error("予算の上限"); }) as never;
  assert.deepEqual(await withKeys(() => scoreProvisional({ material: "材料", ask: fail })), { scored: 0, high: 0 });
  assert.equal(row(id).score, null);
  assert.deepEqual(unscoredProposals().map((r) => r.id), [id]);
});

test("自動の依頼: 仮の点は7点以上のときだけ頼み、理由に「朝会の仮の採点」と出す。5〜7点は月曜の正式な点を待つ", () => {
  db().exec("DELETE FROM plan_requests; DELETE FROM events WHERE kind LIKE 'auto-ask%'");
  const mid = add("仮で6点", { score: 6.5, ago: "-2 days" });
  db().prepare("UPDATE plan_requests SET score_provisional = 1 WHERE id = ?").run(mid);
  assert.equal(nextAutoAsk(), null, "仮の6.5点では頼まない");
  const high = add("仮で8点", { score: 8, ago: "-2 days" });
  db().prepare("UPDATE plan_requests SET score_provisional = 1 WHERE id = ?").run(high);
  const next = nextAutoAsk();
  assert.equal(next?.row.id, high);
  assert.match(next?.why ?? "", /朝会の仮の採点で8\.0点（7点以上なので、月曜の定例会議を待たずに頼む）/);
  // 定例会議で正式な点になれば、5点以上は今までどおり頼む
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now', '-5 days'), status = 'done' WHERE id = ?").run(high);
  db().prepare("UPDATE plan_requests SET score_provisional = 0 WHERE id = ?").run(mid);
  assert.equal(nextAutoAsk()?.row.id, mid);
});

test("定例会議: 仮の点の提案は、入って8日より前でも採点し直す（正式な点にする）", () => {
  db().exec("DELETE FROM plan_requests");
  const old = add("古いが仮の点", { score: 6, ago: "-20 days" });
  db().prepare("UPDATE plan_requests SET score_provisional = 1 WHERE id = ?").run(old);
  const oldFinal = add("古くて正式な点", { score: 6, ago: "-20 days" });
  const ids = scoringExisting().map((r) => r.id);
  assert.ok(ids.includes(old));
  assert.ok(!ids.includes(oldFinal));
});

test("朝会: その日の最初の計画のあとに仮の採点をし、作り直しでは付け直さない", async () => {
  const { createPlan } = await import("../src/lib/plan");
  db().exec("DELETE FROM plan_requests; DELETE FROM daily_plans");
  const id = add("重要な提案");
  const calls: string[] = [];
  const score = fakeAsk(calls);
  const ask = async <T,>(o: { purpose: string; user: string; validate: (v: unknown) => v is T }): Promise<T> => {
    if (o.purpose === "朝会（提案の仮の採点）") return (score as unknown as (x: typeof o) => Promise<T>)(o);
    let v: unknown;
    if (o.purpose === "毎日の計画") v = { bottleneck: "reach", evidence: "e", certainty: "low", review: "r", focus: "f", goals: [], pause_new: false, idea_note: "", research: null, tasks: [] };
    else if (o.purpose === "朝会（意見）") v = { opinion: "意見" };
    else if (o.purpose === "投稿の切り口の分類") v = { types: [] };
    else throw new Error(`想定していない呼び出し: ${o.purpose}`);
    assert.ok(o.validate(v), o.purpose);
    return v as T;
  };
  await withKeys(() => createPlan({ force: true, ask: ask as never, weather: async () => [] }));
  assert.deepEqual(row(id), { score: 8, score_provisional: 1, status: "open" });
  // 作り直し（今日の計画がある）では採点しない
  db().prepare("UPDATE plan_requests SET score = NULL, score_provisional = 0 WHERE id = ?").run(id);
  calls.length = 0;
  await withKeys(() => createPlan({ force: true, ask: ask as never, weather: async () => [] }));
  assert.equal(calls.length, 0);
  assert.equal(row(id).score, null);
});

test("仮の採点: 点が2社以上そろった提案だけ仮の点にする（1社だけの点では決めず、次の朝会でまた採点する）。別軸の案の見方も定例会議と同じ文を渡す。古い順に選ぶ", async () => {
  db().exec("DELETE FROM plan_requests");
  const newer = add("重要な新しい提案", { ago: "-1 hours", proposer: "claude-opus-5-5" });
  const older = add("重要な古い提案", { ago: "-3 days", proposer: "claude-opus-5-5" });
  // 番号は新しいほうが小さいが、入った日時の古い順に並ぶ
  assert.deepEqual(unscoredProposals().map((r) => r.id), [older, newer]);
  const systems: string[] = [];
  const base = fakeAsk([]);
  // GPT だけ失敗する。提案者は Claude なので、採点できるのは Gemini だけ（1社）→ 仮の点にしない
  const gptFails = (async (o: { modelId: string; system: string }) => {
    systems.push(o.system);
    if (o.modelId.startsWith("gpt")) throw new Error("通信の失敗");
    return (base as unknown as (x: typeof o) => Promise<unknown>)(o);
  }) as never;
  assert.deepEqual(await withKeys(() => scoreProvisional({ material: "材料", ask: gptFails })), { scored: 0, high: 0 });
  assert.equal(row(older).score, null);
  assert.ok(systems.every((s) => s.includes("「別軸:」で始まる案は、まだ実績がないので数字の根拠では比べない")));
  // 提案者が Claude でなければ、GPT が失敗しても Claude と Gemini の2社で仮の点にする
  db().prepare("UPDATE plan_requests SET proposer = 'gpt-6.2-sol' WHERE id IN (?, ?)").run(older, newer);
  assert.deepEqual(await withKeys(() => scoreProvisional({ material: "材料", ask: gptFails })), { scored: 2, high: 2 });
  assert.deepEqual(row(older), { score: 8, score_provisional: 1, status: "open" });
});

test("定例会議の点: 書き換えは必ず行い、見送りは返事待ちで頼んでいないものだけ（採点の途中で頼まれた低い点の提案も、仮の点のまま残さない）", async () => {
  const { applyMeetingScore } = await import("../src/lib/weekly");
  db().exec("DELETE FROM plan_requests");
  const low = add("仮で8点だったが正式は低い", { score: 8 });
  const asked = add("採点の途中で頼まれた", { score: 8 });
  const ok = add("仮で6点", { score: 6 });
  db().prepare("UPDATE plan_requests SET score_provisional = 1").run();
  db().prepare("UPDATE plan_requests SET ai_fix_at = datetime('now') WHERE id = ?").run(asked);
  assert.equal(applyMeetingScore(low, 4.04), true);
  assert.deepEqual(row(low), { score: 4, score_provisional: 0, status: "declined" });
  assert.equal(applyMeetingScore(asked, 3.96), false);
  assert.deepEqual(row(asked), { score: 4, score_provisional: 0, status: "open" }, "見送りにはしないが、点は正式なものにする");
  assert.equal(applyMeetingScore(ok, 6.44), false);
  assert.deepEqual(row(ok), { score: 6.4, score_provisional: 0, status: "open" });
});
