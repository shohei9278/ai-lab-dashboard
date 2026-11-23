import "./setup";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { listInterventions, parseSeedRecord, readRecordFiles } from "../src/lib/interventions";

// 人の手の記録は、新しいものを src/data/interventions/<key>.json に1件1ファイルで足す（PR を並べてもぶつからないように）

test("改善の記録のファイル: フォルダの記録は全部読めて、今までの記録と合わせて一覧に出る", () => {
  const { records, errors } = readRecordFiles();
  assert.deepEqual(errors, []);
  assert.ok(records.some((r) => r.key === "interventions-files"));
  const titles = listInterventions().map((x) => x.title);
  for (const r of records) assert.ok(titles.includes(r.title), r.key);
});

test("改善の記録のファイル: 形のおかしいファイルは読まずに、理由を返す", () => {
  const ok = { day: "2026-11-23", kind: "design", title: "t", happened: "h", noticed: "n", decision: "d", result: null, found_by: "human", commit_sha: null };
  assert.equal(typeof parseSeedRecord("good-key", ok), "object");
  for (const [key, v] of [["Bad_Key", ok], ["k", { ...ok, day: "2026-02-31" }], ["k", { ...ok, kind: "other" }], ["k", { ...ok, title: "" }], ["k", { ...ok, found_by: "someone" }], ["k", { ...ok, commit_sha: "xyz" }], ["k", "文字だけ"], ["k", { ...ok, found_by: undefined }], ["k", { ...ok, commit_sha: undefined }], ["k", { ...ok, result: undefined }]] as const) {
    assert.equal(typeof parseSeedRecord(key, v), "string", `${key} ${JSON.stringify(v)}`);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "interventions-"));
  fs.writeFileSync(path.join(dir, "b-new.json"), JSON.stringify({ ...ok, day: "2026-11-24" }));
  fs.writeFileSync(path.join(dir, "a-old.json"), JSON.stringify(ok));
  fs.writeFileSync(path.join(dir, "broken.json"), "{");
  fs.writeFileSync(path.join(dir, "memo.txt"), "読まない");
  const r = readRecordFiles(dir);
  assert.deepEqual(r.records.map((x) => x.key), ["a-old", "b-new"]);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^broken\.json: /);
  assert.deepEqual(readRecordFiles(path.join(dir, "ない")), { records: [], errors: [] });
  // フォルダでないもの（ファイル）を指したときは、空ではなく理由を返す
  assert.match(readRecordFiles(path.join(dir, "a-old.json")).errors[0], /^フォルダを読めない: /);
  fs.rmSync(dir, { recursive: true });
});
