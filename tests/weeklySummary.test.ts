import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { addNoteIdeas, cleanNoteIdeas, noteTitled, noteTopicOf } from "../src/lib/report";

// 週のまとめの気づきを、社内の知見（実験メモ）に自動で入れる（11/28 に運営者が決めた）

test("週のまとめ: 気づきを実験メモに入れる（AI・1回見ただけ・公開しない）。同じ題はもう入れない", () => {
  db().exec("DELETE FROM notes");
  const n = addNoteIdeas([
    { title: "夜の投稿は遊ばれやすい", body: "21〜23時の投稿は訪問3件・遊んだ2件", topic: "idea" },
    { title: "  ", body: "題がない", topic: "idea" },
    { title: "知らない話題", body: "b", topic: "unknown" },
  ]);
  assert.equal(n, 2);
  const rows = db().prepare("SELECT author, topic, certainty, title, body, is_public FROM notes ORDER BY id").all() as Record<string, unknown>[];
  assert.deepEqual(rows, [
    { author: "ai", topic: "idea", certainty: "once", title: "夜の投稿は遊ばれやすい", body: "21〜23時の投稿は訪問3件・遊んだ2件", is_public: 0 },
    { author: "ai", topic: "other", certainty: "once", title: "知らない話題", body: "b", is_public: 0 },
  ]);
  // 同じ題（前の週に入れた・人が足した）は入れない
  assert.equal(addNoteIdeas([{ title: "夜の投稿は遊ばれやすい", body: "別の根拠", topic: "idea" }]), 0);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number }).n, 2);
  assert.equal(noteTitled("夜の投稿は遊ばれやすい"), true);
  assert.equal(noteTitled("まだない気づき"), false);
});

test("週のまとめ: 気づきの形を整え、決まった話題だけを認める（PR #237 の ai-review の指摘）", () => {
  assert.deepEqual(cleanNoteIdeas([{ title: 1, body: "x" }, { title: " 題 ", body: 2, topic: "constructor" }, "x", null]), [{ title: "題", body: "", topic: "constructor" }]);
  assert.deepEqual(cleanNoteIdeas("x"), []);
  assert.equal(noteTopicOf("constructor"), "other");
  assert.equal(noteTopicOf("toString"), "other");
  assert.equal(noteTopicOf("tool"), "tool");
  assert.equal(noteTopicOf(3), "other");
  assert.equal(noteTitled(3), false);
});
