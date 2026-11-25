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
  db().prepare("UPDATE projects SET stage = 'live', public_slug = 'live-bag', public_version = 1, lp_version = 1 WHERE id = ?").run(live);
  seedDesign(live);
  await prepareLp(live, "ボタンを大きく");
  const a = pendingDev(live)!;
  assert.match(a.proposal, /Claude Code で直す/);
  assert.equal((JSON.parse(a.payload) as { instruction: string }).instruction, "ボタンを大きく");
  await decide(a.id, "reject");
  assert.equal(getProject(live)!.stage, "live");
});

test("じっくり案件（PR #90 の3回目の ai-review の指摘）: 開発待ちの却下は、公開の却下と同じく、公開していなければ見送り、公開中なら公開中の版に戻す", async () => {
  const tool = (v: string) => JSON.stringify({ headline: v, tool: { html: "<script></script>", shareText: "x" } });
  // まだ公開していない（作った版はある）案件を、公開の判断で直す指示 → 開発待ち → 却下: 見送り
  const unpublished = addDeep(tool("1"));
  db().prepare("UPDATE projects SET stage = 'lp' WHERE id = ?").run(unpublished);
  seedDesign(unpublished);
  await prepareLp(unpublished, "色を変える");
  await decide(pendingDev(unpublished)!.id, "reject");
  assert.equal(getProject(unpublished)!.stage, "rejected");
  // 公開中（第1版）で、第2版の公開待ちから直す指示 → 開発待ち → 却下: 公開中の第1版に戻して集客中
  const pub = addDeep(tool("2"));
  db().prepare("INSERT INTO lp_versions (project_id, version, lp, note) VALUES (?, 1, ?, '最初'), (?, 2, ?, '直し')").run(pub, tool("1"), pub, tool("2"));
  db().prepare("UPDATE projects SET stage = 'lp', public_slug = 'bag', public_version = 1, lp_version = 2 WHERE id = ?").run(pub);
  seedDesign(pub);
  await prepareLp(pub, "ボタンを大きく");
  await decide(pendingDev(pub)!.id, "reject");
  const after = getProject(pub)!;
  assert.deepEqual([after.stage, after.lp_version, JSON.parse(after.lp!).headline], ["live", 1, "1"]);
});

test("じっくり案件（PR #90 の ai-review の指摘）: 修正の指示で設計書の書き直しに失敗したら、元の開発待ちに戻す", async () => {
  const id = addDeep();
  seedDesign(id);
  await prepareLp(id);
  const a = pendingDev(id)!;
  // テストではAIのキーがないので、設計書の書き直しは失敗する
  await assert.rejects(decide(a.id, "revise", "もっと派手に"));
  assert.equal(pendingDev(id)?.id, a.id);
  assert.ok(db().prepare("SELECT 1 FROM events WHERE project_id = ? AND kind = 'dev-error'").get(id));
});

test("じっくり案件: Claude Code に伝える長さの上限・受け付けの上限・保存の上限がそろっている（保存の所だけ6万文字で、約6.4万文字のツールが黙って捨てられた。#74）", async () => {
  const { TOOL_DEEP_CODE_MAX, TOOL_HTML_MAX, normalizeLp } = await import("../lp-site/src/lp/content");
  const id = addDeep();
  seedDesign(id);
  await prepareLp(id);
  const a = pendingDev(id)!;
  const text = devRequestText(id, (JSON.parse(a.payload) as { design: string }).design, null);
  assert.match(text, new RegExp(`${TOOL_HTML_MAX.toLocaleString("en-US")}文字以内`));
  // AIが1回で書くじっくり案件の上限（6万文字）より長く、Claude Code の上限（8万文字）より短いツール
  const html = `<button id=b>押す</button><script>document.getElementById('b').onclick=()=>{};/*${"x".repeat(TOOL_DEEP_CODE_MAX)}*/</script>`;
  assert.ok(html.length > TOOL_DEEP_CODE_MAX && html.length < TOOL_HTML_MAX);
  const base = { headline: "h", subheadline: "s", pains: ["a", "b", "c"], features: [{ title: "t", body: "b", icon: "clock" }, { title: "t", body: "b", icon: "clock" }, { title: "t", body: "b", icon: "clock" }], cta: "c", faq: [] };
  assert.ok(normalizeLp({ ...base, tool: { html, shareText: "x", data: [{ name: "和菓子" }] } }).tool, "保存できる");
  const job = startDevUpload(a.id, html); // 受け付ける（このあとはAIを呼ぶので、テストでは失敗で終わる）
  await assert.rejects(job);
});
