import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { applyIdeaRevision, getProject, parseIdeaRevision } from "../src/lib/loop";

// 運営者の依頼（#72）: 設計を直す指示でツールの中身が変わったら、案件の解決策・名前なども合わせて直す（設計書だけ変わって食い違わないように）
const addDeep = (publicSlug: string | null = null) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, aim, public_slug) VALUES ('自分だけのスノードーム', '飾るのが好きな人', '閉じこめたい気持ち', '手描き風の小物40種を置いて振る', '30%が振る', 'r', 'idea', 'claude', 'tool', 1, '粒子とガラス', 'spread', ?)",
).run(publicSlug).lastInsertRowid);

test("設計を直す指示: AIが返した案件の直しは、形が合うものだけ受け付け、書かれていない項目は変えない", () => {
  assert.equal(parseIdeaRevision(null), null);
  assert.equal(parseIdeaRevision(undefined), null);
  assert.deepEqual(parseIdeaRevision({ solution: " 景色を振る ", title: null, problem: "", target: "別の人" }), { solution: "景色を振る" });
  // 形が違うもの（文字でない値・オブジェクトでない）は断る（設計書ごとやり直す）
  assert.equal(parseIdeaRevision({ solution: 3 }), undefined);
  assert.equal(parseIdeaRevision("解決策"), undefined);
  // 長すぎる値は切る
  assert.equal(parseIdeaRevision({ title: "あ".repeat(200) })!.title!.length, 80);
});

test("設計を直す指示: 直した中身を案件に入れ、前の値を経過に残す。誰向けは変えない", () => {
  const id = addDeep();
  const changed = applyIdeaRevision(id, { title: "ふって、しずめる", solution: "作り込んだ景色を振る。たまにサンタが通る", problem: "閉じこめたい気持ち" });
  // 今と同じ値（刺さる気持ち）は、変えたことにしない
  assert.deepEqual(changed, ["title", "solution"]);
  const p = getProject(id)!;
  assert.equal(p.title, "ふって、しずめる");
  assert.equal(p.solution, "作り込んだ景色を振る。たまにサンタが通る");
  assert.equal(p.target, "飾るのが好きな人");
  const ev = db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'idea-revise'").get(id) as { message: string };
  assert.match(ev.message, /名前・解決策も直しました/);
  assert.match(ev.message, /前の解決策: 手描き風の小物40種を置いて振る/);
  // 直しがなければ、何も変えず経過にも残さない
  assert.deepEqual(applyIdeaRevision(id, null), []);
  assert.deepEqual(applyIdeaRevision(id, {}), []);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND kind = 'idea-revise'").get(id) as { n: number }).n, 1);
});

test("設計を直す指示: 公開中の案件は、名前を変えない（公開中のツールの名前が勝手に変わらないように）", () => {
  const id = addDeep("p999");
  assert.deepEqual(applyIdeaRevision(id, { title: "新しい名前", solution: "景色を振る" }), ["solution"]);
  assert.equal(getProject(id)!.title, "自分だけのスノードーム");
});
