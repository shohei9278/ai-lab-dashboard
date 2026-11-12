import assert from "node:assert/strict";
import { test } from "node:test";
import { channelOf, channelStats, maskChannels } from "../src/lib/channels";

const posts = new Map([["abcd1234", "threads"], ["xpost123", "x"]]);

test("流入元: 投稿の専用リンクを来た元のページより優先し、来た元はサイト名だけで分ける", () => {
  assert.deepEqual(channelOf({ source: "abcd1234", referrer: "https://www.facebook.com/" }, posts), { key: "threads" });
  assert.deepEqual(channelOf({ source: "index", referrer: "https://hitoride.vercel.app/" }, posts, "hitoride.vercel.app"), { key: "index" });
  assert.deepEqual(channelOf({ source: null, referrer: "https://t.co/xyz" }, posts), { key: "x" });
  assert.deepEqual(channelOf({ source: null, referrer: "https://www.google.co.jp/search?q=秘密" }, posts), { key: "search" });
  assert.deepEqual(channelOf({ source: null, referrer: "https://hitoride.vercel.app/p1" }, posts, "hitoride.vercel.app"), { key: "site" });
  assert.deepEqual(channelOf({ source: null, referrer: "https://blog.example.com/entry/1?id=9" }, posts), { key: "other", host: "blog.example.com" });
  assert.deepEqual(channelOf({ source: null, referrer: "" }, posts), { key: "direct" });
  assert.deepEqual(channelOf({ source: "unknown1", referrer: null }, posts), { key: "direct" });
  assert.deepEqual(channelOf({ source: "related", referrer: "https://hitoride.vercel.app/p1" }, posts, "hitoride.vercel.app"), { key: "site" });
});

test("流入元: 版ごとに最初の流入元で1人と数え、進んだ段を数える", () => {
  const views = [
    { version: 2, visitor_id: "a", source: "abcd1234" },
    { version: 2, visitor_id: "a", source: null, referrer: "https://t.co/" },
    { version: 2, visitor_id: "b", source: "xpost123" },
    { version: 2, visitor_id: "c", referrer: "https://blog.example.com/" },
    { version: 1, visitor_id: "a", source: "xpost123" },
  ];
  const events = [{ version: 2, visitor_id: "a", name: "section_view", detail: "tool" }, { version: 2, visitor_id: "b", name: "section_view", detail: "tool" }];
  const stats = channelStats(views, events, [{ version: 2, visitor_id: "a" }], posts, true);
  const v2 = stats.get(2)!;
  assert.deepEqual(v2.map((r) => [r.label, r.visitors, r.steps.tool_view ?? 0, r.steps.conv ?? 0]), [["Threads", 1, 1, 1], ["X", 1, 1, 0], ["blog.example.com", 1, 0, 0]]);
  assert.equal(stats.get(1)![0].label, "X");
  const masked = maskChannels(v2);
  assert.ok(!masked.some((r) => r.label.includes("example")) && masked.some((r) => r.label === "ほかのサイト"));
});
