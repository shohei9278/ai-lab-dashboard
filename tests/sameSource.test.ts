import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { decideSameSource, parseSameSource, sameSourceGroups, sameSourceLine } from "../src/lib/sameSource";

const it = (label: string, wantId: number | null, extra: Partial<{ solution: string; target: string; channel: string }> = {}) =>
  ({ label, wantId, title: `案${label}`, solution: extra.solution ?? "家計を記録する", target: extra.target ?? "一人暮らし", channel: extra.channel });

test("同じ元の声: 2件以上出た声だけを組にする（声のない案は数えない）", () => {
  const g = sameSourceGroups([it("A", 3), it("B", 7), it("C", null), it("D", 7), it("E", null)]);
  assert.deepEqual(g.map((x) => [x.wantId, x.items.map((i) => i.label)]), [[7, ["B", "D"]]]);
  assert.deepEqual(sameSourceGroups([it("A", 1), it("B", 2)]), []);
});

test("同じ元の声: 違い（機能・届け先）を1行で並べる", () => {
  const line = sameSourceLine({ wantId: 7, items: [it("B", 7, { solution: "レシートを撮って記録", channel: "Xのタグ" }), it("D", 7, { solution: "週の残りを通知", target: "学生" })] });
  assert.ok(!line.includes("\n"));
  assert.match(line, /^声7から2件: 【B】「案B」機能: レシートを撮って記録／届け先: 一人暮らし・Xのタグ ｜ 【D】「案D」機能: 週の残りを通知／届け先: 学生$/);
  // 長い文は切る
  assert.ok(sameSourceLine({ wantId: 1, items: [it("A", 1, { solution: "あ".repeat(200) }), it("B", 1)] }).length < 200);
});

test("同じ元の声: AIの答えから、組にある声の答えだけを取り出す", () => {
  const m = parseSameSource([{ voice: 7, choice: "both" }, { voice: "声3", choice: "one" }, { voice: 9, choice: "both" }, { voice: 7, choice: "one" }, { voice: 4, choice: "maybe" }, null], [3, 4, 7]);
  assert.deepEqual([...m.entries()], [[7, "both"], [3, "one"]]);
  assert.equal(parseSameSource(undefined, [7]).size, 0);
});

test("同じ元の声: 作り分けるのは過半数が答えたときだけ。同数・答えなしは1つに絞る", () => {
  assert.equal(decideSameSource(["both", "both", "one"]), "both");
  assert.equal(decideSameSource(["both", "one"]), "one");
  assert.equal(decideSameSource([]), "one");
  assert.equal(decideSameSource(["one", "one", "both"]), "one");
});
