import assert from "node:assert/strict";
import { test } from "node:test";
import { omittedNote } from "../scripts/ai-review-omitted";

test("GPTのレビュー: 差分から省いたロックファイルを、更新ありとして伝える", () => {
  const note = omittedNote("2\t2\tpackage.json\n454\t914\tpackage-lock.json\n435\t423\tlp-site/package-lock.json\n");
  assert.ok(note.includes("package-lock.json（+454 −914行）") && note.includes("lp-site/package-lock.json（+435 −423行）"));
  assert.ok(!note.includes("package.json（"));
  assert.equal(omittedNote("3\t1\tsrc/app/page.tsx\n"), "");
});
