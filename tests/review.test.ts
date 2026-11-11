import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";

test("LPのチェック: 前の版と比べるときに、ツール本体と自由に書いたページを渡さない", async () => {
  const { beforeForReview } = await import("../src/lib/loop");
  const before = { headline: "見出し", tool: { html: "<p>本体</p>", shareText: "シェア文" }, page: { html: "<p>ページ</p>" } } as unknown as Parameters<typeof beforeForReview>[0];
  const text = JSON.stringify(beforeForReview(before));
  assert.ok(text.includes("見出し"));
  assert.ok(!text.includes("本体") && !text.includes("シェア文") && !text.includes("ページ"));
});

test("ツールのチェック: ページに出さない画面イメージを渡さない", async () => {
  const { toolPageForReview } = await import("../src/lib/loop");
  const page = { headline: "見出し", preview: { title: "画面", kind: "list", rows: [["最後に会った時期", "2〜3年前"]] } } as unknown as Parameters<typeof toolPageForReview>[0];
  const text = JSON.stringify(toolPageForReview(page));
  assert.ok(text.includes("見出し") && !text.includes("2〜3年前"));
});
