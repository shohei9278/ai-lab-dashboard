import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { WAIT_DAYS, humanWaits, notifyLongWaits, waitsText } from "../src/lib/waits";
import { decisionsText, listMeetings, openDecisions } from "../src/lib/meetings";
import { settleDecisions } from "../src/lib/weekly";
import { gather, jstStartUtc } from "../src/lib/report";
import { parseDecide, type AdhocContent } from "../src/lib/adhoc";

// 止まっているものを進める（運営者が決めた）: 人待ちの日数・「あとで決める」の追いかけ・会議の材料の日付の境目

test("人待ち: 運営者へのお願いの待っている日数を渡し、7日以上は当てにしない指示を付け、一度だけ知らせる", () => {
  db().exec("DELETE FROM plan_requests; DELETE FROM events");
  const add = (title: string, daysAgo: number, target = "human", source = "meeting") =>
    db().prepare("INSERT INTO plan_requests (title, source, target, created_at, scene) VALUES (?, ?, ?, datetime('now', ?), '臨時会議「集客」')").run(title, source, target, `-${daysAgo} days`);
  add("管理者への掲載相談", 8);
  add("知人に見てもらう", 2);
  add("仕組みの改善", 9, "system");
  add("運営者が自分で入れた", 9, "human", "human");
  assert.deepEqual(humanWaits().map((w) => [w.title, w.days]), [["管理者への掲載相談", 8], ["知人に見てもらう", 2]]);
  const t = waitsText();
  assert.match(t, /「管理者への掲載相談」8日待ち/);
  assert.match(t, /「知人に見てもらう」2日待ち/);
  assert.match(t, new RegExp(`${WAIT_DAYS}日以上待っているもの（「管理者への掲載相談」）は、やってもらえる前提で計画しない`));
  assert.equal(notifyLongWaits(true), 1);
  assert.match((db().prepare("SELECT message FROM events WHERE kind = 'human-wait'").get() as { message: string }).message, /管理者への掲載相談/);
  // 同じお願いは二度知らせない
  assert.equal(notifyLongWaits(true), 0);
  // 返事待ちがないとき
  db().exec("DELETE FROM plan_requests");
  assert.equal(waitsText(), "運営者の返事待ち: なし");
});

const adhoc = (c: Partial<AdhocContent>, daysAgo: number) =>
  Number(db().prepare("INSERT INTO meetings (kind, period_start, period_end, chair_model, content, topic, at) VALUES ('adhoc', '2026-11-01', '2026-11-01', 'claude-opus-5-5', ?, ?, datetime('now', ?))")
    .run(JSON.stringify({ topic: "集客の方法は増やすべき？", rounds: [], conclusion: "c", actions: [], chair: "claude-opus-5-5", ...c }), c.topic ?? "集客の方法は増やすべき？", `-${daysAgo} days`).lastInsertRowid);

test("あとで決めること: 決める日が来たら材料に出し、定例会議で決めて、会議室に結果を出す", async () => {
  db().exec("DELETE FROM meetings");
  const decide = { question: "Bluesky の宣伝を続けるか", metric: "掲載相談と Threads の1件あたりの訪問", rule: "掲載相談が2件以上たまり、Threads の半分に届かなければやめる", checkAfterDays: 14 };
  const due = adhoc({ decide }, 15);
  adhoc({ topic: "デザインスキルを使うか", decide: { ...decide, question: "デザインスキルを使うか", checkAfterDays: 28 } }, 3);
  adhoc({ topic: "決めきった会議" }, 20);
  assert.deepEqual(openDecisions().map((x) => [x.topic, x.f.due]), [["集客の方法は増やすべき？", true], ["デザインスキルを使うか", false]]);
  const t = decisionsText();
  assert.match(t, /Bluesky の宣伝を続けるか（掲載相談と Threads の1件あたりの訪問で決める: .+）→ 決める日（\d{4}-\d{2}-\d{2}）が来た/);
  assert.match(t, /デザインスキルを使うか.+→ \d{4}-\d{2}-\d{2}に決める/);
  // 決める日が来たものだけを、議長が決める
  const asked: string[] = [];
  const ask = (async (o: { user: string }) => { asked.push(o.user); return { settled: false, decision: "掲載相談がまだ0件なので決められない", note: "Threads は1件あたり2.2人" }; }) as unknown as Parameters<typeof settleDecisions>[1];
  assert.equal(await settleDecisions("claude-opus-5-5", ask), 1);
  assert.equal(asked.length, 1);
  assert.match(asked[0], /決めること: Bluesky の宣伝を続けるか/);
  assert.deepEqual(openDecisions().map((x) => x.topic), ["デザインスキルを使うか"]);
  const m = listMeetings("adhoc", 60).find((x) => x.key === `meeting-${due}`)!;
  assert.equal(m.decide?.decided?.settled, false);
  assert.match(m.decide?.decided?.decision ?? "", /決められない/);
  // 2回目は、もう決めたものは決めない
  assert.equal(await settleDecisions("claude-opus-5-5", ask), 0);
});

test("あとで決めること: 足りない答えは使わない（前後の数字は1日あたりにそろえる）", async () => {
  // 議長の答え: 何を・何の数字で・どうなったらが全部ないと記録しない。日数は 7・14・28 以外なら14日
  const full = { question: "q", metric: "m", rule: "r", check_after_days: 28 };
  assert.deepEqual(parseDecide(full), { question: "q", metric: "m", rule: "r", checkAfterDays: 28 });
  assert.equal(parseDecide({ ...full, metric: "" }), undefined);
  assert.equal(parseDecide({ ...full, rule: 3 }), undefined);
  assert.equal(parseDecide({ ...full, question: "  " }), undefined);
  assert.equal(parseDecide(null), undefined);
  assert.equal(parseDecide({ ...full, check_after_days: 10 })?.checkAfterDays, 14);
  // 決めた結果: 決めたかどうか（true / false）がない答えは、書き直させる
  db().exec("DELETE FROM meetings");
  adhoc({ decide: { question: "q", metric: "m", rule: "r", checkAfterDays: 7 } }, 8);
  let checked: boolean[] = [];
  const ask = (async (o: { validate: (v: unknown) => boolean }) => {
    checked = [o.validate({ decision: "d", note: "n" }), o.validate({ settled: "false", decision: "d", note: "n" }), o.validate({ settled: true, decision: " ", note: "n" }), o.validate({ settled: false, decision: "d", note: "n" })];
    throw new Error("AIの出力を読み取れませんでした（2回失敗）");
  }) as unknown as Parameters<typeof settleDecisions>[1];
  assert.equal(await settleDecisions("claude-opus-5-5", ask), 0);
  assert.deepEqual(checked, [false, false, false, true]);
  // 読み取れなかったものは決めたことにせず、来週また決める
  assert.equal(openDecisions().length, 1);
  // 前（7日）と後で日数が違うので、登録/利用も1日あたりにする
  assert.match(decisionsText(), /登録\/利用 [0-9.—]+人 → [0-9.—]+人/);
});

test("会議の材料の日付の境目: 日本時間の0時から数える（日本時間の0時〜9時の記録も入れる）", () => {
  assert.equal(jstStartUtc("2026-11-14"), "2026-11-13 15:00:00");
  db().exec("DELETE FROM events");
  // 日本時間 11/14 02:00（UTC 11/13 17:00）と、日本時間 11/13 23:00（UTC 11/13 14:00）
  db().prepare("INSERT INTO events (at, actor, kind, message) VALUES ('2026-11-13 17:00:00', 'human', 'x', '週の始めの朝の記録')").run();
  db().prepare("INSERT INTO events (at, actor, kind, message) VALUES ('2026-11-13 14:00:00', 'human', 'x', '前の週の記録')").run();
  const g = gather("2026-11-14");
  assert.match(g, /週の始めの朝の記録/);
  assert.doesNotMatch(g, /前の週の記録/);
});
