import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { getSettings } from "../src/lib/db";
import { AIMS, aimOfIdea, aimWeightsOf, aimsByDeficit, allocateAims, dealAims, genresOf, isAim, pickByAims, type Aim } from "../src/lib/aims";

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
