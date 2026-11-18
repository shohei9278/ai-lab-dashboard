import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings } from "../src/lib/db";
import { decide, devRequestText, devWaiting, getProject, prepareLp, startDevUpload } from "../src/lib/loop";

const addDeep = (lp: string | null = null) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, aim, lp) VALUES ('袋づめ最終審判', '学生', '見せたい', '袋に詰める物理パズル', 'h', 'r', 'idea', 'claude', 'tool', 1, '物理の手ざわり', 'spread', ?)",
).run(lp).lastInsertRowid);
const pendingDev = (id: number) => db().prepare("SELECT * FROM approvals WHERE project_id = ? AND kind = 'dev' AND status = 'pending'").get(id) as { id: number; payload: string; proposal: string } | undefined;
// AIを呼ばずに試すため、前の設計書を置いておく（設計書を直す指示がなければ、前の設計書をそのまま使う）
const seedDesign = (id: number) => db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, status, payload) VALUES (?, 'dev', '前', '前', 'revised', ?)").run(id, JSON.stringify({ design: "## 一言で\n袋に詰める物理パズル", instruction: null }));

test("じっくり案件: 初めの値は 週3件・開発待ち2件まで", () => {
  const s = getSettings();
  assert.equal(s.deepPerWeek, 3);
  assert.equal(s.deepDevWaitMax, 2);
});

test("じっくり案件: ツールはAIが書かずに開発待ちにし、Claude Code への依頼文に設計書・決まり・入れ方を入れる", async () => {
  const id = addDeep();
  seedDesign(id);
  await prepareLp(id, undefined, { auto: true });
  const a = pendingDev(id)!;
  assert.match(a.proposal, /「袋づめ最終審判」のツールを Claude Code で作る/);
  assert.equal(getProject(id)!.lp, null);
  assert.equal(devWaiting(), 1);
  const text = devRequestText(id, (JSON.parse(a.payload) as { design: string }).design, null);
  assert.match(text, /案件 #\d+「袋づめ最終審判」の、じっくり案件のツールを作って/);
  assert.match(text, /袋に詰める物理パズル/);
  assert.match(text, /守ること/);
  assert.match(text, /80,000文字以内/);
  // 承認のボタンでは進めない（HTMLを入れる）
  await assert.rejects(decide(a.id, "approve"), /ツールのHTMLを入れてください/);
});

test("じっくり案件: 入れるHTMLは決まりに合わなければすぐ断り、合えば開発待ちを閉じていつもの流れを始める", async () => {
  const id = addDeep();
  seedDesign(id);
  await prepareLp(id);
  const a = pendingDev(id)!;
  assert.throws(() => startDevUpload(a.id, "<div></div><script>fetch('https://example.com')</script>"), /外部と通信している/);
  assert.throws(() => startDevUpload(a.id, "<script>1</script>" + "x".repeat(80_001)), /長すぎます/);
  assert.throws(() => startDevUpload(a.id, "  "), /空です/);
  assert.ok(pendingDev(id));
  // 合うものは受け付ける（このあとの紹介ページづくりはAIを呼ぶので、テストでは失敗で終わる）
  const job = startDevUpload(a.id, "<button id=b>押す</button><script>document.getElementById('b').onclick=()=>{}</script>");
  assert.equal((db().prepare("SELECT status FROM approvals WHERE id = ?").get(a.id) as { status: string }).status, "approved");
  assert.ok(db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'dev-upload'").get(id));
  // 取り込みの途中で失敗したら（ここではAIのキーがない）、開発待ちに戻して、同じHTMLをもう一度入れられるようにする
  await assert.rejects(job);
  const again = pendingDev(id)!;
  assert.ok(again && again.id !== a.id);
  assert.match((db().prepare("SELECT reason FROM approvals WHERE id = ?").get(again.id) as { reason: string }).reason, /取り込みに失敗しました/);
  assert.equal((JSON.parse(again.payload) as { design: string }).design, "## 一言で\n袋に詰める物理パズル");
});

test("じっくり案件: 開発待ちを却下すると、まだ作っていない案件は見送り、公開中の案件は今の版のまま", async () => {
  const fresh = addDeep();
  seedDesign(fresh);
  await prepareLp(fresh);
  await decide(pendingDev(fresh)!.id, "reject");
  assert.equal(getProject(fresh)!.stage, "rejected");
  const live = addDeep(JSON.stringify({ headline: "h", tool: { html: "<script></script>", shareText: "x" } }));
  db().prepare("UPDATE projects SET stage = 'live' WHERE id = ?").run(live);
  seedDesign(live);
  await prepareLp(live, "ボタンを大きく");
  const a = pendingDev(live)!;
  assert.match(a.proposal, /Claude Code で直す/);
  assert.equal((JSON.parse(a.payload) as { instruction: string }).instruction, "ボタンを大きく");
  await decide(a.id, "reject");
  assert.equal(getProject(live)!.stage, "live");
});
