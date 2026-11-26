import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { plainFacts } from "../src/lib/plan";
import { unsupportedNumbers } from "../src/lib/numberCheck";
import { jstDay } from "../src/lib/sns";

// 普通の投稿の数字の確かめ（numberCheck.ts）: 朝会が見ている数字（宣伝の投稿の成績・直近7日の日ごとの数字）も材料に入れる
// 11/26 に、朝会の見立てにある場所ごとの数字（Threads の遊ぶツールの宣伝は29件・訪問53人・利用0）を書いた実験の記録の投稿が、材料にない数字として止まった

test("普通の投稿の材料: 宣伝の投稿の成績（場所×案件の型）と直近7日の日ごとの数字が入り、それを書いた投稿は止まらない。材料にない数字は今までどおり止まる", () => {
  db().exec("DELETE FROM sns_posts; DELETE FROM metrics");
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, aim) VALUES ('遊ぶ', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool', 'spread')").run().lastInsertRowid);
  const post = db().prepare("INSERT INTO sns_posts (project_id, platform, text, status, author, post_url, posted_at, visits, conversions, code) VALUES (?, ?, 't', 'posted', 'ai', ?, datetime('now', '-2 days'), ?, ?, ?)");
  for (let i = 0; i < 29; i++) post.run(pid, "threads", `https://www.threads.net/p/${i}`, i === 0 ? 53 : 0, 0, `th${i}`);
  for (let i = 0; i < 11; i++) post.run(pid, "x", `https://x.com/u/status/${i}`, i === 0 ? 12 : 0, i === 0 ? 8 : 0, `x${i}`);
  // 14日より前の投稿（直近14日と、これまでの全部で数が変わる。PR #197 の ai-review の指摘）
  db().prepare("INSERT INTO sns_posts (project_id, platform, text, status, author, post_url, posted_at, visits, conversions, code) VALUES (?, 'threads', 't', 'posted', 'ai', 'https://www.threads.net/p/old', datetime('now', '-20 days'), 5, 0, 'thold')").run(pid);
  const yesterday = jstDay(new Date(Date.now() - 86_400_000));
  db().prepare("INSERT INTO metrics (project_id, day, visits, signups, source) VALUES (?, ?, 21, 4, 'real')").run(pid, yesterday);
  const facts = plainFacts();
  assert.match(facts, /直近14日:\n[^]*投稿29件・訪問53人[^]*これまでの全部:\n[^]*投稿30件・訪問58人/);
  assert.match(facts, /投稿11件・訪問12人/);
  assert.match(facts, new RegExp(`${yesterday.slice(5)} 訪問21人・登録/利用4人`));
  assert.deepEqual(unsupportedNumbers("直近14日、Threadsの遊ぶツールの宣伝は29件・訪問53人・利用0。Xは11件・訪問12人・利用8", facts), []);
  assert.deepEqual(unsupportedNumbers("昨日は訪問21人でした", facts), []);
  assert.deepEqual(unsupportedNumbers("宣伝は777件", facts), ["777件"]);
  db().exec("DELETE FROM sns_posts; DELETE FROM metrics");
});

test("普通の投稿の材料: 朝会が見た数字も入れる（投稿までに数字が変わっても、朝会のときの数字を書いた投稿は止まらない。PR #197 の ai-review の指摘）", () => {
  db().exec("DELETE FROM sns_posts; DELETE FROM metrics");
  const atPlan = "朝会が見た数字（2026-11-26 08:00 の時点）:\n直近7日の全案件の数字（日ごと）: 11-25 訪問53人・登録/利用0人";
  assert.deepEqual(unsupportedNumbers("昨日は訪問53人でした", plainFacts(atPlan)), []);
  assert.deepEqual(unsupportedNumbers("昨日は訪問53人でした", plainFacts()), ["53人"]);
});
