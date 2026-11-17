import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLp, toolResultsOf } from "../lp-site/src/lp/content";
import { wrapToolHtml } from "../lp-site/src/lp/toolHtml";
import { staticToolIssues } from "../src/lib/loop";

const base = { headline: "h", subheadline: "s", pains: ["a"], features: [{ title: "t", body: "b" }], cta: "c", faq: [] };

test("結果ごとのシェア: ツールに書かれた結果の一覧を取り出し、長さと数をそろえて残す", () => {
  const html = '<p>x</p><script type="application/json" id="lab-results">["ひだまりタイプ", " ", "あああああああああああああああああああああああああああああああああああ"]</script><script>1</script>';
  assert.deepEqual(toolResultsOf(html), ["ひだまりタイプ", "ああああああああああああああああああああああああああああああ"]);
  assert.equal(toolResultsOf("<script>1</script>"), undefined);
  assert.equal(toolResultsOf('<script id="lab-results">{x</script>'), undefined);
  const lp = normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", results: ["A", 3, "B"] } });
  assert.deepEqual(lp.tool?.results, ["A", "B"]);
  assert.equal(normalizeLp({ ...base, tool: { html: "<script></script>", shareText: "x", results: [] } }).tool?.results, undefined);
});

test("結果ごとのシェア: 枠の中で window.labResult を使え、壊れた結果の一覧はチェックで止める", () => {
  assert.ok(wrapToolHtml("<p>x</p>").includes("window.labResult=function"));
  assert.ok(staticToolIssues('<script id="lab-results">not json</script><script>1</script>').some((x) => x.includes("lab-results")));
  assert.ok(!staticToolIssues('<script type="application/json" id="lab-results">["A"]</script><script>1</script>').some((x) => x.includes("lab-results")));
});
