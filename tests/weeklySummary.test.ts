import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { addNoteIdeas, cleanNoteIdeas, noteTitled, noteTopicOf, toSaved, type Report } from "../src/lib/report";

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
  // 根拠のない気づきは入れない（後で根拠つきで同じ題が出ても入れられるように）
  assert.equal(addNoteIdeas([{ title: "根拠のない気づき", body: "  ", topic: "idea" }, { title: "根拠が数字", body: 3, topic: "idea" }]), 0);
  assert.equal(noteTitled("根拠のない気づき"), false);
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

test("週のまとめ: 保存するのは決まった項目だけ（AIが頼んでいない下書きを返しても残さない。PR #237 の ai-review の指摘）", () => {
  const out = { summary: "s", numbers: [], highlights: ["h"], noteIdeas: [{ title: " 題 ", body: "b", topic: "idea" }, { title: 1 }], next: ["n"], article: "# 頼んでいない記事", xPosts: ["頼んでいない投稿"] } as unknown as Report;
  const saved = toSaved(out, ["採用した提案"]);
  assert.deepEqual(saved, { summary: "s", numbers: [], highlights: ["h"], noteIdeas: [{ title: "題", body: "b", topic: "idea" }], next: ["採用した提案"] });
  assert.equal("article" in saved, false);
  assert.equal("xPosts" in saved, false);
  assert.deepEqual(toSaved(out).next, ["n"]);
});

test("週のまとめ: 保存する気づきは、根拠のあるものだけを3件まで（PR #237 の ai-review の指摘）", () => {
  const ideas = [{ title: "根拠なし", body: "", topic: "idea" }, ...[1, 2, 3, 4].map((i) => ({ title: `気づき${i}`, body: `根拠${i}`, topic: "idea" }))];
  const saved = toSaved({ summary: "s", numbers: [], highlights: [], noteIdeas: ideas, next: [] } as Report);
  assert.deepEqual(saved.noteIdeas.map((x) => x.title), ["気づき1", "気づき2", "気づき3"]);
});
