import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { apiWishOf, apiWishSummary } from "../src/lib/apiWishes";

test("使いたい API: 名前ごとにまとめて多い順に並べ、見るだけの案と名前のないものは数えない", () => {
  const add = db().prepare("INSERT INTO idea_candidates (batch_id, label, author_model, title, payload, practice) VALUES ('b', 'A', 'm', ?, ?, ?)");
  const idea = (title: string, wish: unknown, practice = 0) => add.run(title, JSON.stringify({ title, api_wish: wish }), practice);
  idea("天気で服装", { name: "Open-Meteo", purpose: "地点の天気予報", key: false, sends: "緯度・経度" });
  idea("洗濯日和", { name: " open-meteo ", purpose: "降水確率", key: false, sends: "緯度・経度" });
  idea("本の要約", { name: "Google Books", purpose: "書誌情報", key: true, sends: "ISBN" });
  idea("見るだけ", { name: "Google Books", purpose: "x", key: true, sends: "x" }, 1);
  idea("名前なし", { purpose: "x" });
  idea("API なし", undefined);
  const s = apiWishSummary(30);
  assert.deepEqual(s.map((w) => [w.name, w.count]), [["Open-Meteo", 2], ["Google Books", 1]]);
  assert.deepEqual(s[0].purposes, ["地点の天気予報", "降水確率"]);
  assert.equal(s[0].key, false);
  assert.equal(s[1].key, true);
  assert.equal(apiWishOf({ name: "  " }), null);
  assert.equal(apiWishOf({ name: "x".repeat(61) }), null);
  assert.equal(apiWishOf({ name: "x".repeat(60) })!.name.length, 60);
});
