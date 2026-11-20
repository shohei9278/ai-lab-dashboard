import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { applyIdeaRevision, getProject, parseIdeaRevision, saveDevRequest } from "../src/lib/loop";

// 運営者の依頼（#72）: 設計を直す指示でツールの中身が変わったら、案件の解決策・名前なども合わせて直す（設計書だけ変わって食い違わないように）
const addDeep = (publicSlug: string | null = null) => Number(db().prepare(
  "INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind, deep, deep_plan, aim, public_slug) VALUES ('自分だけのスノードーム', '飾るのが好きな人', '閉じこめたい気持ち', '手描き風の小物40種を置いて振る', '30%が振る', 'r', 'idea', 'claude', 'tool', 1, '粒子とガラス', 'spread', ?)",
).run(publicSlug).lastInsertRowid);

test("設計を直す指示: AIが返した案件の直しは、形が合うものだけ受け付け、書かれていない項目は変えない", () => {
  assert.equal(parseIdeaRevision(null), null);
  assert.deepEqual(parseIdeaRevision({ solution: " 景色を振る ", title: null, problem: "" }), { solution: "景色を振る" });
  // 形が違うもの（文字でない値・オブジェクトでない）は断る（設計書ごとやり直す）
  assert.equal(parseIdeaRevision({ solution: 3 }), undefined);
  assert.equal(parseIdeaRevision("解決策"), undefined);
  // idea の書き忘れ・決めた項目名でないもの（変えない誰向け・名前の間違い）も断る。「変えない」と扱うと、設計書だけが変わって食い違いが残る（PR #109 の ai-review の指摘）
  assert.equal(parseIdeaRevision(undefined), undefined);
  assert.equal(parseIdeaRevision({ name: "新しい名前" }), undefined);
  assert.equal(parseIdeaRevision({ solution: "景色を振る", target: "別の人" }), undefined);
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
  // 長い値も切らずに全文を残す（PR #109 の ai-review の指摘）
  const long = "長い解決策。".repeat(100);
  db().prepare("UPDATE projects SET solution = ? WHERE id = ?").run(long, id);
  applyIdeaRevision(id, { solution: "短い解決策" });
  assert.ok((db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'idea-revise' ORDER BY id DESC").get(id) as { message: string }).message.includes(`前の解決策: ${long}`));
  // 直しがなければ、何も変えず経過にも残さない
  assert.deepEqual(applyIdeaRevision(id, null), []);
  assert.deepEqual(applyIdeaRevision(id, {}), []);
  assert.equal((db().prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND kind = 'idea-revise'").get(id) as { n: number }).n, 2);
});

test("設計を直す指示: 公開中の案件は、名前を変えない（公開中のツールの名前が勝手に変わらないように）", () => {
  const id = addDeep("p999");
  assert.deepEqual(applyIdeaRevision(id, { title: "新しい名前", solution: "景色を振る" }), ["solution"]);
  assert.equal(getProject(id)!.title, "自分だけのスノードーム");
});

test("設計を直す指示: 案件の書き換えと開発待ちの保存は、両方できるか、どちらもしないか（PR #109 の ai-review の指摘）", () => {
  const id = addDeep();
  const n = (kind: string) => (db().prepare("SELECT COUNT(*) AS n FROM events WHERE project_id = ? AND kind = ?").get(id, kind) as { n: number }).n;
  // 開発待ちの保存が失敗したら、案件の中身も経過も変えない（案件だけ変わって、設計書が前のままにならないように）
  db().exec(`CREATE TRIGGER fail_dev BEFORE INSERT ON approvals WHEN NEW.project_id = ${id} BEGIN SELECT RAISE(ABORT, 'テストでの失敗'); END`);
  assert.throws(() => saveDevRequest(id, "## 一言で\n景色を振る", { title: "ふって、しずめる", solution: "景色を振る" }, undefined, "小物をやめる"), /テストでの失敗/);
  assert.equal(getProject(id)!.solution, "手描き風の小物40種を置いて振る");
  assert.equal(n("idea-revise"), 0);
  assert.equal(n("dev-design"), 0);
  db().exec("DROP TRIGGER fail_dev");
  // 保存できれば、案件の中身・経過・開発待ちがそろう。カードには新しい名前を出す
  saveDevRequest(id, "## 一言で\n景色を振る", { title: "ふって、しずめる", solution: "景色を振る" }, undefined, "小物をやめる");
  assert.equal(getProject(id)!.solution, "景色を振る");
  assert.equal(n("idea-revise"), 1);
  const a = db().prepare("SELECT proposal, payload FROM approvals WHERE project_id = ? AND kind = 'dev'").get(id) as { proposal: string; payload: string };
  assert.match(a.proposal, /「ふって、しずめる」のツールを Claude Code で作る/);
  assert.equal((JSON.parse(a.payload) as { design: string }).design, "## 一言で\n景色を振る");
});

test("設計を直す指示: 経過に残す problem の欄の名前は、ねらいで変える（PR #109 の ai-review の指摘）", () => {
  const msg = (aim: string) => {
    const id = addDeep();
    db().prepare("UPDATE projects SET aim = ? WHERE id = ?").run(aim, id);
    applyIdeaRevision(id, { problem: "新しい中身" });
    return (db().prepare("SELECT message FROM events WHERE project_id = ? AND kind = 'idea-revise'").get(id) as { message: string }).message;
  };
  assert.match(msg("spread"), /案件の刺さる気持ちも直しました（前の刺さる気持ち: 閉じこめたい気持ち）/);
  assert.match(msg("return"), /案件の毎日来る動機も直しました（前の毎日来る動機: /);
  assert.match(msg("useful"), /案件の困りごとも直しました（前の困りごと: /);
});
