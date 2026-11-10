import assert from "node:assert/strict";
import { test } from "node:test";
import { plainIssue } from "../src/lib/issueText";

test("AIのチェック結果: 項目名を読める言葉にし、ほかの英単語は変えない", () => {
  assert.equal(plainIssue("前の版にあった tool（本体）と shareText が steps にない"), "前の版にあった ツール本体（本体）と シェア文 が 手順の欄 にない");
  assert.equal(plainIssue("toolbar の CTA"), "toolbar の CTA");
});
