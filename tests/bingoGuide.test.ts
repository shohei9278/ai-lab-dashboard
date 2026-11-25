import assert from "node:assert/strict";
import { test } from "node:test";
import { allocate, GUIDE_BUDGETS, GUIDE_PEOPLE, tierCounts } from "../lp-site/src/lp/bingoGuide";

// 提案箱 #60: 検索で見つかる解説ページの配分表。予算を超えず、全員に当たり、上の等ほど高いこと
test("解説ページの配分表は、予算を超えず、全員に1個ずつ当たり、上の等ほど高い", () => {
  for (const budget of GUIDE_BUDGETS) {
    for (const people of GUIDE_PEOPLE) {
      const a = allocate(people, budget);
      const used = a.rows.reduce((s, r) => s + r.subtotal, 0);
      assert.ok(used <= budget, `${people}人・${budget}円: ${used}円で予算を超えた`);
      assert.equal(used + a.spare, budget);
      assert.ok(a.spare >= 0 && a.spare < budget * 0.1, `${people}人・${budget}円: 余りが多すぎる（${a.spare}円）`);
      assert.equal(a.rows.reduce((s, r) => s + r.count, 0), people);
      for (const r of a.rows) assert.equal(r.unit % 100, 0);
      for (let i = 1; i < a.rows.length; i++) assert.ok(a.rows[i - 1].unit > a.rows[i].unit, `${people}人・${budget}円: ${a.rows[i - 1].label}が${a.rows[i].label}より高くない`);
    }
  }
});

test("個数は、1等1個・2等は人数の1割（最低1個）・3等は2割・残りが参加賞", () => {
  assert.deepEqual(tierCounts(10), { first: 1, second: 1, third: 2, all: 6 });
  assert.deepEqual(tierCounts(30), { first: 1, second: 3, third: 6, all: 20 });
});
