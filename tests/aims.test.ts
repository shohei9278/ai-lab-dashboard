import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSettings } from "../src/lib/db";
import { AIMS, aimOfIdea, aimWeightsOf, aimsByDeficit, alignIdeaAims, allocateAims, dealAims, genresOf, isAim, pickByAims, problemLabel, type Aim } from "../src/lib/aims";

const W = { spread: 4, useful: 3, return: 2, demand: 1 };

test("ねらい: 初めの配分は 広がる4・役に立つ3・また来てもらう2・需要を確かめる1、ジャンルはおまかせ", () => {
  const s = getSettings();
  assert.deepEqual(aimWeightsOf(s), W);
  assert.equal(s.ideaGenres, "");
  // 形はねらいから決まる
  assert.equal(AIMS.demand.kind, "lp");
  assert.ok((["spread", "useful", "return"] as const).every((a) => AIMS[a].kind === "tool"));
});

test("ねらい: 枠を配分どおりに割り振り、各社に交互に配る", () => {
  // 3社×2件 = 6枠: 2.4・1.8・1.2・0.6 → 2・2・1・1
  const six = allocateAims(6, W);
  assert.deepEqual(six, ["spread", "spread", "useful", "useful", "return", "demand"]);
  assert.deepEqual(dealAims(six, 3), [["spread", "useful"], ["spread", "return"], ["useful", "demand"]]);
  // 枠がねらいの数より少ないときは、重みの大きい順
  assert.deepEqual(allocateAims(2, W), ["spread", "useful"]);
  // じっくり案件はツールのねらいだけ
  const tool = allocateAims(4, W, ["spread", "useful", "return"]);
  assert.ok(!tool.includes("demand") && tool.length === 4);
  // 0 にしたねらいは出さない。全部 0 なら、使えるねらいを同じ重みで扱う
  assert.ok(!allocateAims(6, { ...W, demand: 0 }).includes("demand"));
  assert.equal(new Set(allocateAims(4, { spread: 0, useful: 0, return: 0, demand: 0 })).size, 4);
  // 重みの小さいねらいも、枠が足りれば1つは入る
  assert.ok(allocateAims(4, { spread: 9, useful: 9, return: 1, demand: 1 }).includes("demand"));
  assert.deepEqual(allocateAims(0, W), []);
});

test("ねらい: 案件にするときは、配分に比べて足りないねらいから選ぶ", () => {
  // まだ何もなければ、いちばん重いねらいから
  assert.equal(aimsByDeficit(W, {})[0], "spread");
  // 広がるが3件あれば、役に立つ → また来てもらう → 需要を確かめる → 広がる
  assert.deepEqual(aimsByDeficit(W, { spread: 3 }), ["useful", "return", "demand", "spread"]);
  // 絞ったねらいだけ
  assert.deepEqual(aimsByDeficit(W, { spread: 5 }, ["spread"]), ["spread"]);
  // 重みが 0 のねらいは選ばない
  assert.ok(!aimsByDeficit({ ...W, demand: 0 }, { spread: 9, useful: 9, return: 9 }).includes("demand"));
});

test("ねらい: アイデアのねらいは形とそろえ、決めた値だけ受け付ける", () => {
  assert.equal(aimOfIdea({ aim: "spread", kind: "tool" }), "spread");
  assert.equal(aimOfIdea({ aim: "spread", kind: "lp" }), "demand");
  assert.equal(aimOfIdea({ kind: "tool" }), "useful");
  assert.equal(aimOfIdea({}), "demand");
  assert.equal(aimOfIdea({ aim: "constructor", kind: "tool" }), "useful");
  assert.equal(isAim("toString"), false);
  assert.equal(isAim("return"), true);
});

test("ジャンル: カンマ・読点・改行で区切り、重なりと長すぎるものを除く", () => {
  assert.deepEqual(genresOf("ガチャ・診断, 手ざわり、ガチャ・診断\nクイズ, "), ["ガチャ・診断", "手ざわり", "クイズ"]);
  assert.deepEqual(genresOf(""), []);
  assert.deepEqual(genresOf("あ".repeat(31)), []);
});

test("ねらいとジャンルの設定: 配分は0〜10、ジャンルはそろえて保存する", async () => {
  const { POST } = await import("../src/app/api/settings/route");
  const send = (body: unknown) => POST(new Request("http://localhost/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  assert.equal((await send({ aimSpread: 11 })).status, 400);
  assert.equal((await send({ aimDemand: -1 })).status, 400);
  assert.equal((await send({ aimSpread: 6, aimDemand: 0, ideaGenres: "クイズ、手ざわり, クイズ" })).status, 200);
  const s = getSettings();
  assert.equal(s.aimSpread, 6);
  assert.equal(s.aimDemand, 0);
  assert.equal(s.ideaGenres, "クイズ,手ざわり");
});

test("案件にする案の選び方: 足りないねらいの、点の高い案から。下限未満なら次のねらい、どれもなければ点の順", () => {
  const c = (id: string, aim: Aim, avg: number, author = "x") => ({ id, aim, avg, author });
  const all: Aim[] = ["spread", "useful", "return", "demand"];
  const list = [c("u9", "useful", 9), c("s7", "spread", 7), c("s6", "spread", 6, "y"), c("r8", "return", 8), c("d4", "demand", 4)];
  // まだ何もない → 広がるの最高点 → 次は役に立つ
  assert.deepEqual(pickByAims(list, 2, W, {}, all, 5).map((x) => x.id), ["s7", "u9"]);
  // 広がるがもう多い → 役に立つ → また来てもらう
  assert.deepEqual(pickByAims(list, 2, W, { spread: 5 }, all, 5).map((x) => x.id), ["u9", "r8"]);
  // 需要を確かめるが足りなくても、下限（5点）未満の案は選ばない
  assert.ok(!pickByAims(list, 4, W, { spread: 9, useful: 9, return: 9 }, all, 5).slice(0, 3).some((x) => x.id === "d4"));
  // 下限以上の案がどのねらいにもなければ、点の順
  assert.deepEqual(pickByAims([c("a", "spread", 3), c("b", "useful", 4)], 1, W, {}, all, 5).map((x) => x.id), ["b"]);
  // 受け付けない案（じっくり案件の上限など）は飛ばして次へ
  assert.deepEqual(pickByAims(list, 1, W, {}, all, 5, (x) => x.id !== "s7").map((x) => x.id), ["s6"]);
  // 同じ点なら、まだ選んでいない作者の案を先にする
  assert.deepEqual(pickByAims([c("p", "spread", 7, "A"), c("q", "useful", 7, "A"), c("r", "useful", 7, "B")], 2, W, {}, all, 5).map((x) => x.id), ["p", "r"]);
});

test("AIの答えのねらい（PR #84 の ai-review の指摘）: 頼んだねらいにない案は外し、形はねらいに合わせる", () => {
  const r = alignIdeaAims([
    { title: "a", aim: "spread", kind: "lp", genre: " クイズ " },
    { title: "b", aim: "demand", kind: "lp" },
    { title: "c", kind: "tool" },
    { title: "d", aim: "useful", kind: "tool", genre: "あ".repeat(40) },
  ], ["spread", "useful", "useful"]);
  // a は頼んだねらい（形はツールに直す）、b は頼んでいない需要を確かめる → 外す、c は書かれていないので頼んだ順（3件目 = 役に立つ）
  assert.deepEqual(r.ideas.map((x) => [x.title, x.aim, x.kind, x.genre]), [["a", "spread", "tool", "クイズ"], ["c", "useful", "tool", undefined], ["d", "useful", "tool", "あ".repeat(30)]]);
  assert.deepEqual(r.dropped.map((x) => [x.idea.title, x.aim]), [["b", "demand"]]);
  // ねらいごとに頼んだ件数まで（順番の入れ替えはよい）。広がる1・役に立つ1 で 広がる2 が返ったら、2件目は外す（PR #84 の2回目の ai-review の指摘）
  const twice = alignIdeaAims([{ title: "x", aim: "spread", kind: "tool" }, { title: "y", aim: "spread", kind: "tool" }], ["spread", "useful"]);
  assert.deepEqual(twice.ideas.map((x) => x.title), ["x"]);
  assert.deepEqual(twice.dropped.map((x) => [x.idea.title, x.aim]), [["y", "spread"]]);
  const swapped = alignIdeaAims([{ title: "u", aim: "useful", kind: "tool" }, { title: "s", aim: "spread", kind: "tool" }], ["spread", "useful"]);
  assert.deepEqual(swapped.ideas.map((x) => [x.title, x.aim]), [["u", "useful"], ["s", "spread"]]);
  // 書かれた案と書かれていない案が混ざるとき: 書かれた案の分を先に引き、残りを頼んだ順に当てる（PR #84 の3回目の ai-review の指摘）
  const mixed = alignIdeaAims([{ title: "m1", aim: "useful", kind: "tool" }, { title: "m2", kind: "tool" }], ["spread", "useful"]);
  assert.deepEqual(mixed.ideas.map((x) => [x.title, x.aim]), [["m1", "useful"], ["m2", "spread"]]);
  assert.equal(mixed.dropped.length, 0);
  // 残りがなければ、書かれていない案も外す
  const over = alignIdeaAims([{ title: "o1", aim: "spread", kind: "tool" }, { title: "o2", kind: "tool" }], ["spread"]);
  assert.deepEqual([over.ideas.map((x) => x.title), over.dropped.map((x) => x.idea.title)], [["o1"], ["o2"]]);
  // 頼んでいないときは、書かれたねらい（なければ形から）
  assert.deepEqual(alignIdeaAims([{ aim: "return", kind: "lp" }, { kind: "lp" }]).ideas.map((x) => [x.aim, x.kind]), [["return", "tool"], ["demand", "lp"]]);
});

// 運営者の指摘: 遊びの案にも「困りごと」と出ていて、困りごとがあるように見えた。ねらいごとに、アイデアで書かせた中身の名前で出す
test("ねらい: アイデアの problem 欄は、ねらいごとに書かせた中身の名前で出す", () => {
  assert.equal(problemLabel("spread"), "刺さる気持ち");
  assert.equal(problemLabel("return"), "毎日来る動機");
  assert.equal(problemLabel("useful"), "困りごと");
  assert.equal(problemLabel("demand"), "困りごと");
  // ねらいのない前からある案件は、前のまま
  assert.equal(problemLabel(null), "困りごと");
});
