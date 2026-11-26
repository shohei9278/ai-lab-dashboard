import "./setup";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Browser } from "playwright-core";
import { openFirst, type BrowserTry } from "../src/lib/browser";

// ブラウザを開く順番（src/lib/browser.ts）: 開けなければ次を試す。CI では最初の1つ（Playwright の Chromium）だけを使い、元のエラーで落とす（PR #198 の ai-review の指摘）

const fake = {} as Browser;
const ng = (name: string, msg: string): BrowserTry => ({ name, launch: async () => { throw new Error(`${msg}\n詳しいログ`); } });
const ok = (name: string): BrowserTry => ({ name, launch: async () => fake });

test("ブラウザを開く: 開けなければ次を試し、すべて開けなければ理由をログに残して null を返す", async () => {
  assert.equal(await openFirst([ng("A", "壊れた"), ok("B")]), fake);
  const logged: string[] = [];
  const orig = console.error;
  console.error = (m: string) => { logged.push(m); };
  try {
    assert.equal(await openFirst([ng("A", "ライブラリがない"), ng("B", "見つからない")]), null);
  } finally {
    console.error = orig;
  }
  // 原因が2行目より後にあっても残す
  assert.match(logged.join("\n"), /- A: ライブラリがない\n詳しいログ\n- B: 見つからない\n詳しいログ/);
});

test("ブラウザを開く: CI（strict）では最初の1つだけを使い、開けなければ元のエラーで落とす", async () => {
  // 元のエラーをそのまま投げ直す（同じもの）
  const original = new Error("ライブラリがない\nlibnss3.so が見つからない");
  await assert.rejects(openFirst([{ name: "Playwright の Chromium", launch: async () => { throw original; } }, ok("Google Chrome")], true), (e) => e === original);
  assert.equal(await openFirst([ok("Playwright の Chromium"), ok("Google Chrome")], true), fake);
});
