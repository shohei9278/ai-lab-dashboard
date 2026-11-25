import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLp } from "../lp-site/src/lp/content";
import { toolResultsOf } from "../lp-site/src/lp/htmlDom";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";
import { staticToolIssues } from "../src/lib/loop";

const base = { headline: "h", subheadline: "s", pains: ["a"], features: [{ title: "t", body: "b" }], cta: "c", faq: [] };

test("結果ごとのシェア: ツールに書かれた結果の一覧を取り出し、長さと数をそろえて残す", () => {
  const ok = '<p>x</p><script type="application/json" id="lab-results">["ひだまりタイプ", "かげりタイプ"]</script><script>1</script>';
  assert.deepEqual(toolResultsOf(ok), ["ひだまりタイプ", "かげりタイプ"]);
  // 前後の空白は整えずに一覧ごと使わない。type が application/json でないもの・data-id は結果の一覧として読まない
  assert.equal(toolResultsOf('<script type="application/json" id="lab-results">[" ひだまり "]</script>'), undefined);
  assert.equal(toolResultsOf('<script id="lab-results">["A"]</script>'), undefined);
  assert.equal(toolResultsOf('<script type="application/json" data-id="lab-results">["A"]</script>'), undefined);
  // ai-review の指摘: 結果の一覧が2つ以上あるときは読まず、チェックで止める
  const two = '<script type="application/json" id="lab-results">["A"]</script><script id="lab-results">["B"]</script><script>1</script>';
  assert.equal(toolResultsOf(two), undefined);
  assert.ok(staticToolIssues(two).some((x) => x.includes("lab-results")));
  assert.ok(staticToolIssues('<script id="lab-results">["A"]</script><script>1</script>').some((x) => x.includes("lab-results")));
  assert.ok(!staticToolIssues('<script type="application/json" data-id="lab-results">["A"]</script><script>1</script>').some((x) => x.includes("lab-results")));
  // ai-review の指摘: 要素を除いたり切ったりすると番号がずれるので、1つでもおかしければ一覧ごと使わない
  const tag = (v: unknown) => `<script type="application/json" id="lab-results">${JSON.stringify(v)}</script><script>1</script>`;
  assert.equal(toolResultsOf(tag(["A", " ", "B"])), undefined);
  assert.equal(toolResultsOf(tag(["A", "あ".repeat(31)])), undefined);
  assert.equal(toolResultsOf(tag(Array.from({ length: 41 }, (_, i) => `R${i}`))), undefined);
  assert.equal(toolResultsOf(tag([])), undefined);
  assert.ok(staticToolIssues(tag(["A", "", "B"])).some((x) => x.includes("lab-results")));
  assert.equal(toolResultsOf("<script>1</script>"), undefined);
  assert.equal(toolResultsOf('<script id="lab-results">{x</script>'), undefined);
  // ai-review の指摘: 引用符なしの属性も読み、id・type が2回書かれたものは読まない
  assert.deepEqual(toolResultsOf('<script type=application/json id=lab-results>["A"]</script>'), ["A"]);
  assert.equal(toolResultsOf('<script type=text/javascript id=lab-results>["A"]</script>'), undefined);
  assert.ok(staticToolIssues('<script type=text/javascript id=lab-results>["A"]</script><script>1</script>').some((x) => x.includes("lab-results")));
  assert.equal(toolResultsOf('<script type="text/javascript" type="application/json" id="lab-results">["A"]</script>'), undefined);
  // 同じ名前の属性が2つあるときは、ブラウザと同じく最初のものを使う
  assert.deepEqual(toolResultsOf('<script type="application/json" id="lab-results" id="x">["A"]</script>'), ["A"]);
  // ai-review の指摘: 文字参照（&#45; など）で書かれた id もブラウザと同じく読む
  assert.ok(staticToolIssues('<script id="lab&#45;results" type="text/javascript">["A"]</script><script>1</script>').some((x) => x.includes("lab-results")));
  assert.deepEqual(toolResultsOf('<script type="application/json" id="lab&#45;results">["A"]</script>'), ["A"]);
  // コメントの中に書かれたものは数えない
  assert.deepEqual(toolResultsOf('<!-- <script id="lab-results"></script> --><script type="application/json" id="lab-results">["A"]</script>'), ["A"]);
  assert.equal(normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", results: ["A", 3, "B"] } }).tool?.results, undefined);
  assert.deepEqual(normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", results: ["A", "B"] } }).tool?.results, ["A", "B"]);
  assert.equal(normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", results: [] } }).tool?.results, undefined);
});

test("結果ごとのシェア: 枠の中で window.labResult を使え、壊れた結果の一覧はチェックで止める", () => {
  assert.ok(wrapToolHtml("<p>x</p>").includes("window.labResult=function"));
  assert.ok(staticToolIssues('<script id="lab-results">not json</script><script>1</script>').some((x) => x.includes("lab-results")));
  assert.ok(!staticToolIssues('<script type="application/json" id="lab-results">["A"]</script><script>1</script>').some((x) => x.includes("lab-results")));
});

test("提案箱 #62: ツールを直すときに一部だけが返ってきたら、全体ではないと見分ける", async () => {
  const { isPartialTool } = await import("../src/lib/loop");
  const prev = `<div>ツール</div><script>${"x".repeat(5000)}</script>`;
  // 新しく作るとき（今のツールがない）は見分けない
  assert.equal(isPartialTool("<p>1行</p>"), false);
  // 変えた1行だけ
  assert.equal(isPartialTool('<button id="go">はじめる</button>', prev), true);
  // 全体を返した（少し短くなった・規模を絞った）ときは、一部とは見なさない
  assert.equal(isPartialTool(prev.slice(0, 4000), prev), false);
  assert.equal(isPartialTool(prev.slice(0, 1100), prev), false);
});
