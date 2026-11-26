import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db, getSettings, saveSettings } from "../src/lib/db";
import { maybeResearchWants, sameDemand, wants, wantsText, WANT_RESEARCH_MIN } from "../src/lib/wants";

// 欲しい仕組み（運営者が決めた）: アイデアが「要る」「使いたい」と書いたものを数え、何度も出たら使えるサービスを調べ、定例会議に渡す

const idea = (title: string, payload: Record<string, unknown>, o: { practice?: number; ago?: string } = {}) =>
  db().prepare("INSERT INTO idea_candidates (at, batch_id, label, author_model, title, payload, practice) VALUES (datetime('now', ?), 'b', 'A', 'claude-opus-5-5', ?, ?, ?)")
    .run(o.ago ?? "-1 days", title, JSON.stringify(payload), o.practice ?? 0);
const store = (what = "みんなのランキング") => ({ needs: [{ kind: "store", what, why: "みんなの結果を見せる" }] });
const reset = () => db().exec("DELETE FROM idea_candidates; DELETE FROM research");
const noop = async () => {};

test("欲しい仕組み: 直近30日の案の「要る仕組み」と「使いたいAPI」を、案の数で数える（人が用意できるもの・見るだけの案・古い案は数えない）", () => {
  reset();
  idea("ランキング診断", { needs: [{ kind: "store", what: "みんなのランキング", why: "w" }, { kind: "store", what: "投票", why: "w" }] }); // 同じ案の中の2つは1件
  idea("みんなの投票", store("投票の集計"));
  idea("天気の服", { needs: [{ kind: "api", what: "天気予報", why: "w" }, { kind: "asset", what: "絵", why: "w" }] }); // 素材は数えない
  idea("見るだけ", store(), { practice: 1 });
  idea("古い案", store(), { ago: "-40 days" });
  idea("地図の道具", { api_wish: { name: "OpenStreetMap", purpose: "地図を出す", key: false, sends: "なし" } });
  const list = wants();
  const s = list.find((w) => w.key === "need:store")!;
  assert.deepEqual([s.count, s.examples], [2, ["ランキング診断", "みんなの投票"]]);
  assert.match(s.detail, /みんなのランキング \/ 投票の集計/);
  assert.equal(list.find((w) => w.key === "need:api")!.count, 1);
  assert.equal(list.some((w) => w.key === "need:asset"), false);
  const map = list.find((w) => w.key === "api:openstreetmap")!;
  // 使いたいAPI にも、どの案が欲しがったかを残す（PR #194 の ai-review の指摘）
  assert.deepEqual([map.label, map.count, map.examples], ["使いたいAPI「OpenStreetMap」", 1, ["地図の道具"]]);
  assert.match(map.detail, /用途: 地図を出す・鍵: 要らない/);
  // 定例会議の材料: 数と、契約を頼むときの書き方（鍵の値は書かせない・つなぐ仕組みの案は出させない）
  const text = wantsText();
  assert.match(text, /保存の場所（[^）]*）: 2件（例: 「ランキング診断」・「みんなの投票」）/);
  assert.match(text, /Railway の変数の名前と、値の取り方。値そのものは書かない/);
  assert.match(text, /この集計を根拠に契約や用意を運営者に頼むのは、何度も出ていて、「調べたこと」に調べ終わった結果があるものだけ/);
  assert.match(text, /調べるのは週に1回までなので、まだ調べていないものもある/);
});

test("欲しい仕組み: 同じものが3件以上の案で欲しがられたら、使えるサービスを調べる（同じものは30日に1回・全体で週に1回まで・緊急停止中は調べない）", () => {
  reset();
  const ran: number[] = [];
  const run = async (id: number) => { ran.push(id); };
  for (let i = 0; i < WANT_RESEARCH_MIN - 1; i++) idea(`保存の案${i}`, store());
  assert.equal(maybeResearchWants({ run }), null, "2件ではまだ調べない");
  idea("保存の案3", store());
  const id = maybeResearchWants({ run });
  assert.ok(id);
  assert.deepEqual(ran, [id]);
  const r = db().prepare("SELECT question, why, how, plan_id, asked_by FROM research WHERE id = ?").get(id) as { question: string; why: string; how: string; plan_id: number | null; asked_by: string };
  assert.match(r.question, /保存の場所.*候補を2〜3個比べる（欲しい仕組みの調べもの: need:store）/);
  assert.match(r.why, /3件が欲しがった/);
  assert.match(r.how, /料金と無料枠.*契約したあとに入れるもの（APIキーなど。値は書かない）.*Supabase をすでに使っている/);
  assert.deepEqual([r.plan_id, r.asked_by], [null, "system"]);
  // 週に1回まで（別の欲しいものが3件になっても、今週は調べない）
  for (let i = 0; i < 3; i++) idea(`天気の案${i}`, { needs: [{ kind: "api", what: "天気", why: "w" }] });
  assert.equal(maybeResearchWants({ run }), null);
  // 週がたてば、まだ調べていないもの（外部のAPI）を調べる。同じもの（保存の場所）は30日のあいだ調べない
  db().prepare("UPDATE research SET at = datetime('now', '-8 days')").run();
  const id2 = maybeResearchWants({ run });
  assert.match((db().prepare("SELECT question FROM research WHERE id = ?").get(id2) as { question: string }).question, /need:api/);
  // 緊急停止中は調べない
  db().prepare("UPDATE research SET at = datetime('now', '-40 days')").run();
  const before = getSettings().killSwitch;
  try {
    saveSettings({ killSwitch: true });
    assert.equal(maybeResearchWants({ run: noop }), null);
  } finally {
    saveSettings({ killSwitch: before });
  }
  reset();
});

test("欲しい仕組み: 「要る仕組み: 外部のAPI」と「使いたいAPI」は同じものとみなして2回調べない。API の名前の記号は文字のまま探す（PR #194 の ai-review の指摘）", () => {
  reset();
  const run = async () => {};
  // 同じ3案が、要る仕組み（外部のAPI）と使いたいAPI の両方に地図を書いた
  for (let i = 0; i < 3; i++) idea(`地図の案${i}`, { needs: [{ kind: "api", what: "地図", why: "w" }], api_wish: { name: "Map_Box", purpose: "地図", key: true, sends: "なし" } });
  const first = maybeResearchWants({ run });
  assert.match((db().prepare("SELECT question FROM research WHERE id = ?").get(first) as { question: string }).question, /need:api/);
  // 週がたっても、使いたいAPI「Map_Box」は、要る仕組み（外部のAPI）を調べたばかりなので調べない
  db().prepare("UPDATE research SET at = datetime('now', '-8 days')").run();
  assert.equal(maybeResearchWants({ run }), null);
  // 案が違う、名前のない外部のAPIの需要（天気）は、地図を調べたあとでも、翌週に別の需要として調べる
  for (let i = 0; i < 3; i++) idea(`天気の案${i}`, { needs: [{ kind: "api", what: "天気", why: "w" }] });
  db().prepare("DELETE FROM idea_candidates WHERE title LIKE '地図の案%'").run();
  for (let i = 0; i < 3; i++) idea(`地図だけの案${i}`, { api_wish: { name: "Map_Box", purpose: "地図", key: true, sends: "なし" } });
  db().prepare("DELETE FROM research").run();
  db().prepare("INSERT INTO research (at, question, asked_by) VALUES (datetime('now', '-8 days'), '（欲しい仕組みの調べもの: api:map_box）', 'system')").run();
  const weather = maybeResearchWants({ run });
  assert.match((db().prepare("SELECT question, why FROM research WHERE id = ?").get(weather) as { question: string }).question, /need:api/);
  // 名前の _ を LIKE の記号として扱わない: 「MapXBox」を調べた記録では、「Map_Box」は止まらない
  reset();
  for (let i = 0; i < 3; i++) idea(`地図の案${i}`, { api_wish: { name: "Map_Box", purpose: "地図", key: true, sends: "なし" } });
  db().prepare("INSERT INTO research (at, question, asked_by) VALUES (datetime('now', '-8 days'), '（欲しい仕組みの調べもの: api:mapxbox）', 'system')").run();
  const id = maybeResearchWants({ run });
  assert.match((db().prepare("SELECT question FROM research WHERE id = ?").get(id) as { question: string }).question, /api:map_box/);
  reset();
});

test("欲しい仕組み: 集計と契約の決まりは定例会議だけに渡し、臨時会議の材料（meetingMaterial）には入れない（PR #194 の ai-review の指摘）", async () => {
  const { meetingMaterial } = await import("../src/lib/weekly");
  reset();
  for (let i = 0; i < 3; i++) idea(`保存の案${i}`, store());
  assert.doesNotMatch(meetingMaterial("2026-11-01"), /欲しい仕組み（直近/);
  reset();
});

test("欲しい仕組み: 同じ需要かは、調べたときに元にした案の番号で、多いほうの案の数の半分以上が同じかで決める（PR #195 の ai-review の指摘）", () => {
  // どちらから比べても同じ答え（8案のうち3案だけが重なるなら、別の需要）
  assert.deepEqual([sameDemand([1, 2, 3], [1, 2, 3, 4, 5, 6, 7, 8]), sameDemand([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3])], [false, false]);
  assert.deepEqual([sameDemand([1, 2, 3], [1, 2, 3, 4]), sameDemand([1, 2, 3, 4], [1, 2, 3])], [true, true]);
  reset();
  const run = async () => {};
  // 天気の3案で「要る仕組み: 外部のAPI」を調べた（調べたときの案の番号が残る）
  for (let i = 0; i < 3; i++) idea(`天気の案${i}`, { needs: [{ kind: "api", what: "天気", why: "w" }] });
  const first = maybeResearchWants({ run })!;
  const saved = JSON.parse((db().prepare("SELECT want_ideas FROM research WHERE id = ?").get(first) as { want_ideas: string }).want_ideas) as number[];
  assert.equal(saved.length, 3);
  // そのあと、外部のAPIと地図の両方を書いた別の3案が増えた。今の集計の「外部のAPI」には地図の案も入るが、調べたのは天気の案なので、地図は別の需要として翌週に調べる
  for (let i = 0; i < 3; i++) idea(`地図の案${i}`, { needs: [{ kind: "api", what: "地図", why: "w" }], api_wish: { name: "MapBox", purpose: "地図", key: true, sends: "なし" } });
  db().prepare("UPDATE research SET at = datetime('now', '-8 days')").run();
  const second = maybeResearchWants({ run });
  assert.match((db().prepare("SELECT question FROM research WHERE id = ?").get(second) as { question: string }).question, /api:mapbox/);
  // 題が同じでも別の案なら、同じ案とはみなさない（番号で比べる）
  reset();
  for (let i = 0; i < 3; i++) idea("同じ題", { needs: [{ kind: "api", what: "天気", why: "w" }] });
  maybeResearchWants({ run });
  db().prepare("DELETE FROM idea_candidates").run();
  for (let i = 0; i < 3; i++) idea("同じ題", { api_wish: { name: "Weather", purpose: "天気", key: true, sends: "なし" } });
  db().prepare("UPDATE research SET at = datetime('now', '-8 days')").run();
  assert.match((db().prepare("SELECT question FROM research WHERE id = ?").get(maybeResearchWants({ run })) as { question: string }).question, /api:weather/);
  reset();
});
