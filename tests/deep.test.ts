import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, saveSettings } from "../src/lib/db";
import { capRows, cleanRows, deepAllowance, isDeepSpec, sampleRows, type DeepField } from "../src/lib/deep";
import { decide, isDeepIdea, staticToolIssues, type Idea } from "../src/lib/loop";
import { pendingApprovals } from "../src/lib/views";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";
import { TOOL_DATA_ROWS_MAX, TOOL_DEEP_CODE_MAX, normalizeLp } from "../lp-site/src/lp/content";

const FIELDS: DeepField[] = [{ key: "name", label: "市町村名", kind: "fact" }, { key: "mood", label: "雰囲気", kind: "view" }];

test("じっくり案件の枠: データは window.labData に置き、閉じタグで抜けられない。Google Fonts は fonts のときだけ開ける", () => {
  const html = wrapToolHtml("<p>x</p>", { data: [{ name: "</script><script>alert(1)</script>" }], fonts: true });
  assert.ok(html.includes("window.labData="));
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("https://fonts.googleapis.com") && html.includes("https://fonts.gstatic.com"));
  const plain = wrapToolHtml("<p>x</p>");
  assert.ok(!plain.includes("labData") && !plain.includes("fonts.googleapis.com"));
  // 親のページが遅れて受け取れるようになっても、聞き直せば高さを知らせ直す
  assert.ok(plain.includes('e.data.__lab==="ping")h()'));
});

test("じっくり案件の中身: 上限を超えるデータは公開する中身に入れない", () => {
  const base = { headline: "h", subheadline: "s", pains: ["a", "b", "c"], features: [{ title: "t", body: "b", icon: "clock" }, { title: "t", body: "b", icon: "clock" }, { title: "t", body: "b", icon: "clock" }], cta: "c", faq: [] };
  const ok = normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", data: [{ name: "札幌市" }], fonts: true } });
  assert.deepEqual(ok.tool?.data, [{ name: "札幌市" }]);
  assert.equal(ok.tool?.fonts, true);
  const big = normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", data: Array.from({ length: TOOL_DATA_ROWS_MAX + 1 }, (_, i) => ({ i })) } });
  assert.equal(big.tool?.data, undefined);
  assert.equal(normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", fonts: "yes" } }).tool?.fonts, undefined);
  const long = `<script>${"x".repeat(TOOL_DEEP_CODE_MAX)}</script>`;
  assert.equal(normalizeLp({ ...base, tool: { html: long, shareText: "x", data: [{ name: "札幌市" }] } }).tool, undefined);
  assert.ok(normalizeLp({ ...base, tool: { html: long, shareText: "x" } }).tool);
});

test("じっくり案件のコードの決まり: Google Fonts の読み込みだけを許し、ほかの外部ファイルや通信は止める", () => {
  const font = '<link href="https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic&display=swap" rel="stylesheet"><script>1</script>';
  assert.ok(staticToolIssues(font, false).some((x) => x.includes("外部のファイル")));
  assert.deepEqual(staticToolIssues(font, true), []);
  assert.ok(staticToolIssues('<link href="https://example.com/a.css" rel="stylesheet"><script>1</script>', true).some((x) => x.includes("外部のファイル")));
  assert.ok(staticToolIssues('<script>fetch("https://fonts.googleapis.com/x")</script>', true).some((x) => x.includes("通信")));
  const long = `<script>${"x".repeat(TOOL_DEEP_CODE_MAX)}</script>`;
  assert.ok(staticToolIssues(long, true).some((x) => x.includes("長すぎる")));
  assert.ok(!staticToolIssues(long, false).some((x) => x.includes("長すぎる")));
});

test("じっくり案件のデータ: 項目がそろった行だけを残し、同じ行を除き、例は等間隔に取る", () => {
  const rows = cleanRows([{ name: "札幌市", mood: "にぎやか" }, { name: "小樽市" }, { name: "函館市", mood: 3 }, "x", { name: "札幌市", mood: "にぎやか" }], FIELDS);
  assert.deepEqual(rows, [{ name: "札幌市", mood: "にぎやか" }, { name: "函館市", mood: 3 }, { name: "札幌市", mood: "にぎやか" }]);
  assert.equal(capRows(rows).length, 2);
  assert.deepEqual(sampleRows([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5), [1, 3, 5, 7, 9]);
  assert.equal(isDeepSpec({ fields: FIELDS, groups: ["北海道"], per_group: "全市町村", note: "説明" }), true);
  assert.equal(isDeepSpec({ fields: [{ key: "Name", label: "x", kind: "fact" }], groups: ["a"], per_group: "", note: "" }), false);
  assert.equal(isDeepSpec({ fields: [FIELDS[0], FIELDS[0]], groups: ["a"], per_group: "", note: "" }), false);
});

test("じっくり案件: tool で要るデータが書かれた案だけ。直近7日の上限で数える", () => {
  const idea = { title: "t", target: "t", problem: "p", solution: "s", hypothesis: "h", reason: "r", confidence: 0.5 } as Idea;
  assert.equal(isDeepIdea({ ...idea, kind: "tool", deep: "全国の市町村" }), true);
  assert.equal(isDeepIdea({ ...idea, kind: "lp", deep: "全国の市町村" }), false);
  assert.equal(isDeepIdea({ ...idea, kind: "tool", deep: " " }), false);
  saveSettings({ deepPerWeek: 2 });
  const before = deepAllowance();
  db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep) VALUES ('じっくり', 't', 'p', 's', 'h', 'r', 'idea', 'm', 'tool', 1)").run();
  assert.equal(deepAllowance(), Math.max(0, before - 1));
  saveSettings({ deepPerWeek: 0 });
  assert.equal(deepAllowance(), 0);
  saveSettings({ deepPerWeek: 1 });
});

test("じっくり案件のデータの確認: 中身の例は運営者にだけ見せ、却下すると案件を見送る", async () => {
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_need) VALUES ('運命の町', 't', 'p', 's', 'h', 'r', 'idea', 'm', 'tool', 1, '全国の市町村')").run().lastInsertRowid);
  const spec = { fields: FIELDS, groups: ["北海道"], per_group: "全市町村", note: "説明" };
  const dataId = Number(db().prepare("INSERT INTO deep_data (project_id, spec, rows) VALUES (?, ?, ?)").run(pid, JSON.stringify(spec), JSON.stringify([{ name: "札幌市", mood: "にぎやか" }])).lastInsertRowid);
  const aid = Number(db().prepare("INSERT INTO approvals (project_id, kind, proposal, reason, payload) VALUES (?, 'data', 'データを確かめる', '理由', ?)").run(pid, JSON.stringify({ dataId })).lastInsertRowid);
  const owner = pendingApprovals(pid, true).find((a) => a.id === aid)!;
  assert.equal(owner.data?.count, 1);
  assert.deepEqual(owner.data?.sample, [{ name: "札幌市", mood: "にぎやか" }]);
  assert.equal(owner.project.deep, true);
  const guest = pendingApprovals(pid).find((a) => a.id === aid)!;
  assert.equal(guest.data?.count, 1);
  assert.equal(guest.data?.sample, undefined);
  await decide(aid, "reject");
  assert.equal((db().prepare("SELECT stage FROM projects WHERE id = ?").get(pid) as { stage: string }).stage, "rejected");
  assert.equal((db().prepare("SELECT status FROM deep_data WHERE id = ?").get(dataId) as { status: string }).status, "rejected");
});
