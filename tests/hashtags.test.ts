import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/lib/db";
import { extractTags, popularTags, tagHints, tagRule } from "../src/lib/hashtags";
import { AUTO_PLATFORMS } from "../src/lib/snsApi";

test("ハッシュタグ（運営者の依頼）: 本文から取り出す（# と ＃。2〜30文字。同じものは1つ）", () => {
  assert.deepEqual(extractTags("値付けに迷う #ハンドメイド作家 さんへ ＃無料ツール #ハンドメイド作家 #a #2026年"), ["#ハンドメイド作家", "#無料ツール", "#2026年"]);
  assert.deepEqual(extractTags("タグなし"), []);
});

test("ハッシュタグ: 話題の投稿で使われているタグを、使われた投稿の数（同じなら、いいねの合計）の多い順に返す", () => {
  const add = (text: string, likes: number, status = "ok", ago = 1) => db().prepare("INSERT INTO viral_posts (tweet_id, url, status, text, likes, at) VALUES (?, 'u', ?, ?, ?, datetime('now', ?))").run(`t${Math.random()}`, status, text, likes, `-${ago} days`);
  add("あ #診断メーカー #心理テスト", 10);
  add("い #診断メーカー", 5);
  add("う #心理テスト #個人開発", 500);
  add("え #個人開発", 1);
  add("読めなかった #読めない", 999, "error");
  add("古い #古いタグ", 999, "ok", 120);
  // どれも2件ずつなので、いいねの合計（心理テスト 510・個人開発 501・診断メーカー 15）の多い順
  assert.deepEqual(popularTags(), ["#心理テスト", "#個人開発", "#診断メーカー"]);
  assert.match(tagHints(), /実際に使われているハッシュタグ（多い順。.*）: #心理テスト #個人開発 #診断メーカー/);
});

test("ハッシュタグ: 数は投稿先ごと（X は2つ・Threads は1つ・Bluesky は3つ。普通の投稿は少なめ）。決まりの文に数と選び方が入る", () => {
  assert.deepEqual([AUTO_PLATFORMS.x.tagMax, AUTO_PLATFORMS.threads.tagMax, AUTO_PLATFORMS.bluesky.tagMax], [2, 1, 3]);
  assert.deepEqual([AUTO_PLATFORMS.x.plainTagMax, AUTO_PLATFORMS.threads.plainTagMax, AUTO_PLATFORMS.bluesky.plainTagMax], [1, 1, 2]);
  assert.match(tagRule(2), /ハッシュタグは2つまで/);
  assert.match(tagRule(2), /実際に検索・フォローしていそうな言葉/);
  assert.match(tagRule(2), /作った言葉/);
  assert.equal(tagRule(0), "ハッシュタグは付けない");
});

test("遊ぶ様子の動画の投稿文（運営者が見つけた）: 専用リンク付きの人の下書きにする（自動投稿には使わない）。X でも自分で投稿したら記録できる", async () => {
  const { POST } = await import("../src/app/api/sns/route");
  const post = (body: Record<string, unknown>) => POST(new Request("http://localhost/api/sns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const pid = Number(db().prepare("INSERT INTO projects (title, target, problem, solution, hypothesis, ai_reason, stage, model_id, kind) VALUES ('t', 't', 'p', 's', 'h', 'r', 'live', 'claude', 'tool')").run().lastInsertRowid);
  const res = await post({ action: "add", projectId: pid, text: "ど真ん中に置ける？ #目測ゲーム", platform: "x", angle: "遊ぶ様子の動画" });
  assert.equal(res.status, 200);
  const { id } = (await res.json()) as { id: number };
  const row = db().prepare("SELECT author, angle, platform, code, status FROM sns_posts WHERE id = ?").get(id) as { author: string; angle: string; platform: string; code: string; status: string };
  assert.deepEqual([row.author, row.angle, row.platform, row.status], ["human", "遊ぶ様子の動画", "x", "draft"]);
  assert.ok(row.code);
  // 自動投稿が使うのは AI の下書きだけ
  assert.equal(db().prepare("SELECT 1 FROM sns_posts WHERE project_id = ? AND status = 'draft' AND author = 'ai'").get(pid), undefined);
  // X の下書きも「自分で投稿した」で記録できる
  assert.equal((await post({ action: "posted", id, text: "ど真ん中に置ける？ #目測ゲーム" })).status, 200);
  assert.equal((db().prepare("SELECT status FROM sns_posts WHERE id = ?").get(id) as { status: string }).status, "posted");
});

test("ハッシュタグ（PR #100 の ai-review の指摘）: 長いタグは途中で切って数えない。決まりの数を超えたタグは後ろから外す", async () => {
  const long = "あ".repeat(31);
  assert.deepEqual(extractTags(`#${long} #ちょうど${"い".repeat(26)}`), [`#ちょうど${"い".repeat(26)}`]);
  const { limitTags } = await import("../src/lib/hashtags");
  assert.equal(limitTags("値付けに迷ったら。 #ハンドメイド作家 #無料ツール #値付け", 2), "値付けに迷ったら。 #ハンドメイド作家 #無料ツール");
  assert.equal(limitTags("1行目 #a1\n2行目 #b2 #c3", 1), "1行目 #a1\n2行目");
  assert.equal(limitTags("タグなし", 2), "タグなし");
  assert.equal(limitTags("#だけ #二つ", 0), "");
  // 動画の投稿文の案も、決まりの数（2つ）までにそろえる
  const { parsePlayScript } = await import("../src/lib/playVideo");
  assert.equal(parsePlayScript({ hook: "h", caption: "置くだけ。 #目測ゲーム #無料ツール #診断 #多すぎ", steps: [{ do: "click", target: "決める" }] })!.caption, "置くだけ。 #目測ゲーム #無料ツール");
});
