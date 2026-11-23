import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings } from "../src/lib/db";
import { ongoingCalls, tracked } from "../src/lib/ai";
import { officeSnapshot, officeWorking, showcaseOfficeSnapshot } from "../src/lib/office";
import { activityList, liveStep, liveEnd, withActivity } from "../src/lib/loop";
import { LIVE_LINGER_SECONDS, liveStateAt, stateAt, type OfficeEvent } from "../src/lib/officeShared";

test("オフィス: ツールを書くような長いAIの呼び出しの間も、その社員は開発室にいる（呼んだ記録は終わってから書くため）", async () => {
  const id = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('袋づめ最終審判', 't', 'p', 's', 'h', 'r', 'lp', 'claude', 'tool')").run().lastInsertRowid);
  let done!: () => void;
  const call = tracked("claude-opus-5-5", "ツール作成", id, () => new Promise<void>((ok) => { done = ok; }));
  // 呼んでいる途中: 呼んだ記録（ai_calls）はまだないが、開発室でツールを作っている
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM ai_calls WHERE purpose = 'ツール作成'").get() as { n: number }).n, 0);
  const snap = officeSnapshot();
  const s = liveStateAt(snap.events, snap.working, snap.now).anthropic;
  assert.deepEqual([s.room, s.doing, s.project, s.projectId], ["dev", "ツール作成", "袋づめ最終審判", id]);
  // 呼んだ回数・費用には数えない（途中の分は、いまの作業（working）にだけ出す。呼んだ記録は終わって書かれたときに数える）
  assert.ok(!snap.events.some((e) => e.member === "anthropic" && e.doing === "ツール作成"));
  done();
  await call;
  assert.equal(ongoingCalls().length, 0);
  // 終わったら、いまの作業からすぐ消える
  assert.ok(!officeSnapshot().working.some((w) => w.member === "anthropic" && w.doing === "ツール作成"));
});

test("AIを呼ぶ関数（PR #92 の ai-review の指摘）: 設定やモデルの誤りも、その場で投げずに Promise の失敗として返す", async () => {
  const { callLong } = await import("../src/lib/ai");
  let job: Promise<string> | undefined;
  assert.doesNotThrow(() => { job = callLong({ modelId: "no-such-model", purpose: "試し", system: "", user: "" } as Parameters<typeof callLong>[0]); });
  await assert.rejects(job!);
});

test("作業中の登録: 長い作業は、終わるまで「いまAIがやっていること」に出て、失敗しても消える。オフィスでは担当のAIがその部屋にいる", async () => {
  let done!: () => void;
  let stepFn!: (s: string) => void;
  const job = withActivity({ key: "play-video-1", title: "遊ぶ様子の動画「雪玉」", model: "claude-opus-5-5", room: "pr" }, (step) => { stepFn = step; return new Promise<void>((ok) => { done = ok; }); });
  const a = activityList().find((x) => x.key === "play-video-1")!;
  assert.deepEqual([a.title, a.model, a.room, a.steps["Claude Opus 5.5"]], ["遊ぶ様子の動画「雪玉」", "claude-opus-5-5", "pr", "始めました"]);
  stepFn("録画しています");
  assert.equal(activityList().find((x) => x.key === "play-video-1")!.steps["Claude Opus 5.5"], "録画しています");
  const w = officeWorking().find((x) => x.member === "anthropic")!;
  assert.deepEqual([w.room, w.doing], ["pr", "遊ぶ様子の動画「雪玉」"]);
  done();
  await job;
  assert.ok(!activityList().some((x) => x.key === "play-video-1"));
  assert.ok(!officeWorking().some((x) => x.member === "anthropic"));
  // 失敗しても消える
  await assert.rejects(withActivity({ key: "check-eval-9", title: "公開前チェックの評価", model: "gpt-5.6-sol" }, async () => { throw new Error("だめ"); }));
  assert.ok(!activityList().some((x) => x.key === "check-eval-9"));
});

test("オフィスのいまの作業: 進み具合の欄に名前が出ているAI（会議・アイデア出し）も、その部屋にいる。AIでない欄は数えない", () => {
  liveStep("idea-test", "アイデア出し", "Gemini 3.1 Pro (preview)", "アイデアを考えています");
  liveStep("idea-test", "アイデア出し", "X の検索", "話題の投稿を確かめています");
  const ws = officeWorking().filter((x) => x.doing === "アイデア出し");
  assert.deepEqual(ws.map((x) => [x.member, x.room]), [["google", "meeting"]]);
  liveEnd("idea-test");
  assert.equal(officeWorking().filter((x) => x.doing === "アイデア出し").length, 0);
});

test("オフィスのいま: いまの作業がある社員はその部屋に、終わった呼び出しは20秒だけ残して休憩室に戻る（再生では3分）", () => {
  const ev: OfficeEvent[] = [{ at: "2026-11-23 10:00:00", member: "openai", room: "meeting", doing: "採点", project: null, projectId: null, yen: 1 }];
  const at = (s: number) => new Date(Date.parse("2026-11-23T10:00:00Z") + s * 1000).toISOString().replace("T", " ").slice(0, 19);
  assert.equal(liveStateAt(ev, [], at(LIVE_LINGER_SECONDS)).openai.room, "meeting");
  assert.equal(liveStateAt(ev, [], at(LIVE_LINGER_SECONDS + 1)).openai.room, "lounge");
  assert.equal(stateAt(ev, at(LIVE_LINGER_SECONDS + 1)).openai.room, "meeting", "直近24時間の再生では、これまでどおり3分");
  const working = [{ member: "openai" as const, room: "dev" as const, doing: "評価", project: null, projectId: null, since: at(0) }];
  assert.equal(liveStateAt(ev, working, at(600)).openai.room, "dev");
});

test("オフィスのいまの作業: クラウドのルーティンが作っているツールは Claude が開発室で作る。概要ページでは、公開していない案件の名前を伏せる", () => {
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('非公開の秘密案件', 't', 'p', 's', 'h', 'r', 'idea', 'claude', 'tool')").run().lastInsertRowid);
  db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, routine_at) VALUES (?, 'dev', '作る', 'r', datetime('now'))").run(pid);
  const w = officeWorking().find((x) => x.projectId === pid)!;
  assert.deepEqual([w.member, w.room, w.project], ["anthropic", "dev", "非公開の秘密案件"]);
  liveStep("pt", "プロンプトの比較「非公開の秘密案件」", "Claude Opus 5.5", "比べています");
  saveSettings({ showcaseEnabled: true });
  const shown = JSON.stringify(showcaseOfficeSnapshot().working);
  assert.doesNotMatch(shown, /非公開の秘密案件/);
  assert.match(shown, /プロンプトの比較/);
  liveEnd("pt");
  db().prepare("DELETE FROM approvals WHERE project_id = ?").run(pid);
});
