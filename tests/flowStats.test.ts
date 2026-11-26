import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { checkFlowJump, durText, flowStats, flowText } from "../src/lib/flowStats";

// 仕組みの詰まり（運営者が決めた）: 工程ごとに、直近7日に止まっていた時間の合計を、記録から数える

const H = 3_600_000;
const NOW = Date.now();
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString().replace("T", " ").slice(0, 19);
const project = (title: string, demo = 0) => Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, demo) VALUES (?, 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', ?)").run(title, demo).lastInsertRowid);
const approval = (pid: number, kind: string, createdAgo: number, decidedAgo: number | null, status = decidedAgo === null ? "pending" : "approved") =>
  db().prepare("INSERT INTO approvals (project_id, kind, status, proposal, reason, created_at, decided_at) VALUES (?, ?, ?, 'p', 'r', ?, ?)").run(pid, kind, status, at(createdAgo), decidedAgo === null ? null : at(decidedAgo));
const request = (title: string, o: { target: string; source?: string; createdAgo: number; askedAgo?: number; decidedAgo?: number; status?: string }) =>
  db().prepare("INSERT INTO plan_requests (title, target, source, status, created_at, ai_fix_at, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(title, o.target, o.source ?? "plan", o.status ?? (o.decidedAgo === undefined ? "open" : "done"), at(o.createdAgo), o.askedAgo === undefined ? null : at(o.askedAgo), o.decidedAgo === undefined ? null : at(o.decidedAgo));
const reset = () => db().exec("DELETE FROM approvals; DELETE FROM plan_requests; DELETE FROM events WHERE kind = 'flow-alert'");
const row = (stage: string) => flowStats(NOW).find((r) => r.stage === stage)!;
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.01, `${a} ≒ ${b}`);

test("仕組みの詰まり: 工程ごとに、直近7日にかかる分だけ止まっていた時間を足し、いま待っているものと長いものを出す", () => {
  reset();
  const p = project("ふって、しずめる");
  // 人の判断待ち: 10時間で決まった公開の承認（直近7日の中）と、9日前から待っている判断（直近7日の分は168時間、その前の7日の分は48時間）
  approval(p, "publish", 30, 20);
  approval(p, "decision", 9 * 24, null);
  // 開発待ち: 2日前から待っている
  approval(p, "dev", 48, null);
  // 決まったのに決めた時刻のない古い記録は、いつまで待ったか分からないので数えない
  approval(p, "idea", 5, null, "approved");
  // デモの案件は数えない
  approval(project("デモ", 1), "publish", 5, null);
  const judge = row("judge");
  near(judge.hours, 10 + 168);
  near(judge.prevHours, 48);
  assert.deepEqual([judge.entered, judge.finished, judge.waiting], [1, 1, 1]);
  near(judge.avgHours!, 10);
  assert.equal(judge.oldest[0].title, "判断: #" + p + " ふって、しずめる");
  near(judge.oldest[0].hours, 9 * 24);
  const dev = row("dev");
  near(dev.hours, 48);
  assert.deepEqual([dev.waiting, dev.finished], [1, 0]);
});

test("仕組みの詰まり: 提案箱は、頼むまで（依頼待ち）と、頼んでからマージまで（直し）に分け、運営者が自分で書いたお願いは数えない", () => {
  reset();
  // 仕組みの改善: 30時間待って頼み、そこから6時間でマージ
  request("詰まりを数える", { target: "system", createdAgo: 40, askedAgo: 10, decidedAgo: 4 });
  // 仕組みの改善: 頼まずに見送り
  request("見送った", { target: "system", createdAgo: 20, decidedAgo: 8, status: "declined" });
  // 仕組みの改善: 頼んで、まだ PR がマージされていない
  request("直している", { target: "system", createdAgo: 12, askedAgo: 3 });
  // AIが運営者にお願いしたもの（返事待ち）と、運営者が自分で書いたもの（数えない）
  request("掲載の相談", { target: "human", createdAgo: 72 });
  request("自分のメモ", { target: "human", source: "human", createdAgo: 72 });
  const wait = row("boxWait");
  near(wait.hours, 30 + 12 + 9);
  assert.deepEqual([wait.finished, wait.waiting], [3, 0]);
  const fix = row("boxFix");
  near(fix.hours, 6 + 3);
  assert.deepEqual([fix.finished, fix.waiting], [1, 1]);
  assert.equal(fix.oldest[0].title, "直している");
  const ask = row("ask");
  near(ask.hours, 72);
  assert.deepEqual([ask.waiting, ask.oldest.map((o) => o.title)], [1, ["掲載の相談"]]);
});

test("仕組みの詰まり: 定例会議の材料に、工程ごとの時間と長いものを渡す。記録がなければそう書く", () => {
  reset();
  assert.match(flowText(NOW), /まだ記録がない/);
  request("掲載の相談", { target: "human", createdAgo: 72 });
  const text = flowText(NOW);
  assert.match(text, /運営者へのお願い: 合計3\.0日（その前の7日は0時間）・入った1件・終わった0件・いま待っている1件（長いもの: 「掲載の相談」3\.0日）/);
  assert.match(text, /止まった時間の長さで直す価値を見る/);
  assert.deepEqual([durText(0), durText(0.1), durText(47.4), durText(48), durText(60)], ["0時間", "1時間未満", "47時間", "2.0日", "2.5日"]);
});

test("仕組みの詰まり: 直近7日の合計が前の7日の2倍以上で48時間以上増えた工程があれば、1週に1回だけ知らせる", () => {
  reset();
  const p = project("知らせ");
  // 前の7日に24時間、直近7日に24時間: 増えていないので知らせない
  approval(p, "publish", 9 * 24, 8 * 24);
  approval(p, "publish", 30, 6);
  assert.equal(checkFlowJump(NOW), null);
  // 直近7日に、さらに3日待っている開発待ち: 72時間増えたので知らせる
  approval(p, "dev", 72, null);
  assert.match(checkFlowJump(NOW) ?? "", /開発待ち（Claude Code でツールを作る）が直近7日で合計3\.0日（その前の7日は0時間・いま待っている1件）/);
  // 同じ週は二度知らせない
  assert.equal(checkFlowJump(NOW), null);
  reset();
});
